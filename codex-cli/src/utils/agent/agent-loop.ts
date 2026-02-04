import type { ReviewDecision } from "./review.js";
import type { ApplyPatchCommand, ApprovalPolicy } from "../../approvals.js";
import type { AppConfig } from "../config.js";
import type {
  ChatCompletionChunk,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions/completions.mjs";
import type { ReasoningEffort } from "openai/resources.mjs";
import type { Stream } from "openai/streaming.mjs";

import { log, isLoggingEnabled } from "./log.js";
import { OPENAI_TIMEOUT_MS } from "../config.js";
import {
  flattenToolCalls,
  parseToolCallArguments,
  tryExtractToolCallsFromContent,
} from "../parsers.js";
import {
  ORIGIN,
  CLI_VERSION,
  getSessionId,
  setCurrentModel,
  setSessionId,
} from "../session.js";
import { handleExecCommand } from "./handle-exec-command.js";
import { tools } from "./tool-definitions.js";
import * as handlers from "./tool-handlers.js";
import { validateFileSyntax } from "./validate-file.js";
import { appendFileSync } from "fs";
import { randomUUID } from "node:crypto";

import OpenAI, { APIConnectionTimeoutError } from "openai";
import { GoogleGenAI } from "@google/genai";
import { prefix } from "./system-prompt.js";
import { join } from "path";
import type { AgentContext, AgentLoopParams, CommandConfirmation } from "./types.js";
export type { AgentContext, AgentLoopParams, CommandConfirmation };
import { SemanticMemory } from "./semantic-memory.js";

// Wait time before retrying after rate limit errors (ms).
const RATE_LIMIT_RETRY_WAIT_MS = parseInt(
  process.env["OPENAI_RATE_LIMIT_RETRY_WAIT_MS"] || "2500",
  10,
);

const alreadyProcessedResponses = new Set();

export class AgentLoop {
  private model: string;
  private instructions?: string;
  private approvalPolicy: ApprovalPolicy;
  private config: AppConfig;

  // Using `InstanceType<typeof OpenAI>` sidesteps typing issues with the OpenAI package under
  // the TS 5+ `moduleResolution=bundler` setup. OpenAI client instance. We keep the concrete
  // type to avoid sprinkling `any` across the implementation while still allowing paths where
  // the OpenAI SDK types may not perfectly match. The `typeof OpenAI` pattern captures the
  // instance shape without resorting to `any`.
  private oai: any;

  private onItem: (item: ChatCompletionMessageParam) => void;
  private onPartialUpdate?: (content: string, reasoning?: string, activeToolName?: string, activeToolArguments?: Record<string, any>) => void;
  private onLoading: (loading: boolean) => void;
  private onFileAccess?: (path: string) => void;
  private getCommandConfirmation: (
    command: Array<string>,
    applyPatch: ApplyPatchCommand | undefined,
  ) => Promise<CommandConfirmation>;

  /**
   * A reference to the currently active stream returned from the OpenAI
   * client. We keep this so that we can abort the request if the user decides
   * to interrupt the current task (e.g. via the escape hot‑key).
   */
  private currentStream: Stream<ChatCompletionChunk> | null = null;
  /** Incremented with every call to `run()`. Allows us to ignore stray events
   * from streams that belong to a previous run which might still be emitting
   * after the user has canceled and issued a new command. */
  private generation = 0;
  private semanticMemory: SemanticMemory;
  /** AbortController for in‑progress tool calls (e.g. shell commands). */
  private execAbortController: AbortController | null = null;
  /** Set to true when `cancel()` is called so `run()` can exit early. */
  private canceled = false;
  /** Function calls that were emitted by the model but never answered because
   *  the user cancelled the run.  We keep the `call_id`s around so the *next*
   *  request can send a dummy `function_call_output` that satisfies the
   *  contract and prevents the
   *    400 | No tool output found for function call …
   *  error from OpenAI. */
  private pendingAborts: Set<string> = new Set();
  /** Set to true by `terminate()` – prevents any further use of the instance. */
  private terminated = false;
  /** Master abort controller – fires when terminate() is invoked. */
  private hardAbort = new AbortController();

  private currentActiveToolName: string | undefined = undefined;
  private currentActiveToolRawArguments: string | undefined = undefined;

  private onReset: () => void;

  private mapOpenAiToGoogleMessages(
    messages: Array<ChatCompletionMessageParam>,
  ): { contents: any[]; systemInstruction: any } {
    const contents: any[] = [];
    let systemInstruction: any = undefined;

    for (const msg of messages) {
      if (msg.role === "system") {
        systemInstruction = { parts: [{ text: msg.content }] };
        continue;
      }

      const role = msg.role === "assistant" ? "model" : "user";
      const parts: any[] = [];

      if (msg.role === "assistant") {
        if (msg.content && typeof msg.content === "string") {
          parts.push({ text: msg.content });
        }
        if (msg.tool_calls) {
          for (const tc of msg.tool_calls as any[]) {
            let args = {};
            try {
              args = JSON.parse(tc.function.arguments);
            } catch {
              /* ignore */
            }
            parts.push({
              functionCall: {
                name: tc.function.name,
                args,
              },
            });
          }
        }
      } else if (msg.role === "user") {
        if (typeof msg.content === "string") {
          parts.push({ text: msg.content });
        } else if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part.type === "text") {
              parts.push({ text: part.text });
            }
          }
        }
      } else if (msg.role === "tool") {
        let response = {};
        try {
          response = JSON.parse(msg.content as string);
        } catch {
          response = { output: msg.content };
        }
        // For Google GenAI SDK, functionResponse needs the name.
        // We try to find it from previous messages if possible, but for now we'll assume it's passed or use a placeholder.
        // Actually, the OpenAI tool message doesn't have the name, only tool_call_id.
        // A better way is to track it, but for a simple mapping we might need to find the name from history.
        let name = "unknown";
        for (let i = messages.indexOf(msg) - 1; i >= 0; i--) {
          const prev = messages[i] as any;
          if (prev?.role === "assistant" && prev.tool_calls) {
            const tc = prev.tool_calls.find(
              (c: any) => (c.id || c.call_id) === msg.tool_call_id,
            );
            if (tc) {
              name = tc.function.name;
              break;
            }
          }
        }

        parts.push({
          functionResponse: {
            name,
            response,
          },
        });
      }

      if (parts.length > 0) {
        // Merge consecutive roles to satisfy Google API requirements
        if (contents.length > 0 && contents[contents.length - 1].role === role) {
          contents[contents.length - 1].parts.push(...parts);
        } else {
          contents.push({ role, parts });
        }
      }
    }

    return { contents, systemInstruction };
  }

  private mapOpenAiToGoogleTools(openAiTools: any[]): any[] {
    const functionDeclarations: any[] = [];

    for (const tool of openAiTools) {
      if (tool.type === "function") {
        functionDeclarations.push({
          name: this.sanitizeGoogleToolName(tool.function.name),
          description: tool.function.description,
          parameters: tool.function.parameters,
        });
      }
    }

    return functionDeclarations.length > 0
      ? [{ functionDeclarations }]
      : [];
  }

  private async *googleToOpenAiStream(googleStream: any): AsyncGenerator<any> {
    let first = true;
    for await (const chunk of googleStream) {
      const candidate = chunk.candidates?.[0];
      const parts = candidate?.content?.parts || [];

      const delta: any = {};
      if (first) {
        delta.role = "assistant";
        first = false;
      }
      for (const part of parts) {
        if (part.text) {
          delta.content = (delta.content || "") + part.text;
        }
        if (part.functionCall) {
          if (!delta.tool_calls) {
            delta.tool_calls = [];
          }
          delta.tool_calls.push({
            index: delta.tool_calls.length,
            id: randomUUID(),
            function: {
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args),
            },
          });
        }
      }

      if (Object.keys(delta).length > 0 || candidate?.finishReason) {
        yield {
          choices: [
            {
              delta,
              finish_reason: candidate?.finishReason?.toLowerCase() || null,
            },
          ],
        };
      }
    }
  }

  private sanitizeGoogleToolName(name: string): string {
    // Gemini tool names:
    // Must start with a letter or underscore.
    // Must be alphanumeric, underscores, dots, colons, or dashes.
    // Max length 64.
    let sanitized = name.replace(/[^a-zA-Z0-9_.:-]/g, "_");
    if (sanitized.length > 64) {
      sanitized = sanitized.slice(0, 64);
    }
    return sanitized;
  }

  /**
   * Tracks history of tool calls in the current session to detect loops.
   * Key: tool name + stringified arguments
   * Value: { count: number, lastError?: string }
   */
  private toolCallHistory: Map<string, { count: number; lastError?: string }> =
    new Map();

  /**
   * Abort the ongoing request/stream, if any. This allows callers (typically
   * the UI layer) to interrupt the current agent step so the user can issue
   * new instructions without waiting for the model to finish.
   */
  public cancel(): void {
    if (this.terminated) {
      return;
    }
    if (isLoggingEnabled()) {
      log(
        `AgentLoop.cancel() invoked – currentStream=$
{Boolean(
          this.currentStream,
        )} execAbortController=$
{Boolean(
          this.execAbortController,
        )} generation=$
{this.generation}`,
      );
    }
    this.currentStream?.controller?.abort?.();
    this.canceled = true;
    this.execAbortController?.abort();
    if (isLoggingEnabled()) {
      log("AgentLoop.cancel(): execAbortController.abort() called");
    }

    // If we have *not* seen any function_call IDs yet there is nothing that
    // needs to be satisfied in a follow‑up request.  In that case we clear
    // the stored lastResponseId so a subsequent run starts a clean turn.
    if (this.pendingAborts.size === 0) {
      try {
        this.toolCallHistory.clear();
        this.onReset();
      } catch {
        /* ignore */
      }
    }

    // NOTE: We intentionally do *not* clear `lastResponseId` here.  If the
    // stream produced a `function_call` before the user cancelled, OpenAI now
    // expects a corresponding `function_call_output` that must reference that
    // very same response ID.  We therefore keep the ID around so the
    // follow‑up request can still satisfy the contract.
    this.onLoading(false);

    /* Inform the UI that the run was aborted by the user. */
    // const cancelNotice: ResponseItem = {
    //   role: "assistant",
    //   content: [
    //     {
    //       type: "text",
    //       text: "⏹️  Execution canceled by user.",
    //     },
    //   ],
    // };
    // this.onItem(cancelNotice);

    this.generation += 1;
    if (isLoggingEnabled()) {
      log(`AgentLoop.cancel(): generation bumped to ${this.generation}`);
    }
  }

  public async indexCodebase(onProgress?: (current: number, total: number, file: string) => void): Promise<void> {
    return this.semanticMemory.indexCodebase(onProgress);
  }

  public async searchCode(query: string, limit: number = 5): Promise<any[]> {
    return this.semanticMemory.search(query, limit);
  }

  /**
   * Hard‑stop the agent loop. After calling this method the instance becomes
   * unusable: any in‑flight operations are aborted and subsequent invocations
   * of `run()` will throw.
   */
  public terminate(): void {
    if (this.terminated) {
      return;
    }
    this.terminated = true;

    this.hardAbort.abort();

    this.cancel();
  }

  public sessionId: string;
  /*
   * Cumulative thinking time across this AgentLoop instance (ms).
   * Currently not used anywhere – comment out to keep the strict compiler
   * happy under `noUnusedLocals`.  Restore when telemetry support lands.
   */
  // private cumulativeThinkingMs = 0;
  constructor({
    model,
    instructions,
    approvalPolicy,
    // `config` used to be required.  Some unit‑tests (and potentially other
    // callers) instantiate `AgentLoop` without passing it, so we make it
    // optional and fall back to sensible defaults.  This keeps the public
    // surface backwards‑compatible and prevents runtime errors like
    // "Cannot read properties of undefined (reading 'apiKey')" when accessing
    // `config.apiKey` below.
    config,
    onItem,
    onPartialUpdate,
    onLoading,
    onFileAccess,
    getCommandConfirmation,
    onReset,
  }: AgentLoopParams & { config?: AppConfig }) {
    this.model = model;
    this.instructions = instructions;
    this.approvalPolicy = approvalPolicy;

    // If no `config` has been provided we derive a minimal stub so that the
    // rest of the implementation can rely on `this.config` always being a
    // defined object.  We purposefully copy over the `model` and
    // `instructions` that have already been passed explicitly so that
    // downstream consumers (e.g. telemetry) still observe the correct values.
    this.config =
      config ??
      ({
        model,
        instructions: instructions ?? "",
      } as AppConfig);
    this.onItem = onItem;
    this.onPartialUpdate = onPartialUpdate;
    this.onLoading = onLoading;
    this.onFileAccess = onFileAccess;
    this.getCommandConfirmation = getCommandConfirmation;
    this.onReset = onReset;
    this.sessionId = getSessionId() || randomUUID().replaceAll("-", "");
    // Configure OpenAI client with optional timeout (ms) from environment
    const timeoutMs = OPENAI_TIMEOUT_MS;
    const apiKey = this.config.apiKey;
    const baseURL = this.config.baseURL;
    if (this.config.provider === "google" || this.config.provider === "gemini") {
      this.oai = new GoogleGenAI({
        apiKey: apiKey || "",
      });
    }else{
      this.oai = new OpenAI({
        // The OpenAI JS SDK only requires `apiKey` when making requests against
        // the official API.  When running unit‑tests we stub out all network
        // calls so an undefined key is perfectly fine.  We therefore only set
        // the property if we actually have a value to avoid triggering runtime
        // errors inside the SDK (it validates that `apiKey` is a non‑empty
        // string when the field is present).
        ...(apiKey ? { apiKey } : {}),
        ...(baseURL ? { baseURL } : {}),
        /*defaultHeaders: {
          "User-Agent": "opencodex/1.2.0",
          //originator: ORIGIN,
          //version: CLI_VERSION,
          session_id: this.sessionId,
        },*/
        ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}),
      });
    }



    this.semanticMemory = new SemanticMemory(this.oai, this.config.provider, this.config.embeddingModel);

    setSessionId(this.sessionId);
    setCurrentModel(this.model);

    this.hardAbort = new AbortController();

    this.hardAbort.signal.addEventListener(
      "abort",
      () => this.execAbortController?.abort(),
      { once: true },
    );
  }

  private async handleFunctionCall(
    itemArg: ChatCompletionMessageParam,
  ): Promise<Array<ChatCompletionMessageParam>> {
    if (this.canceled) {
      return [];
    }
    if (itemArg.role !== "assistant" || !itemArg.tool_calls) {
      return [];
    }

    const results: Array<ChatCompletionMessageParam> = [];

    const toolCallPromises = itemArg.tool_calls.map(async (toolCall) => {
      // Normalise the function‑call item
      const isChatStyle = (toolCall as any).function != null;

      let name: string | undefined = isChatStyle
        ? (toolCall as any).function?.name
        : (toolCall as any).name;

      if (name) {
        // Strip common model-specific suffixes that leak into tool names
        name = name.split("<|")[0];
        if (name) {
          name = name.split("---")[0];
        }
        if (name) {
          name = name.trim();
        }

        if (name && (this.config.provider === "google" || this.config.provider === "gemini")) {
          name = this.sanitizeGoogleToolName(name);
        }

                    // Map repo_browser aliases to standard names

                    if (name === "repo_browser.exec" || name === "repo_browser.exec<|channel|>commentary" || name === "repo_browser.exec__channel__commentary") {name = "shell";}

                    if (name === "repo_browser.read_file" || name === "repo_browser.open_file" || name === "repo_browser.cat" || name === "repo_browser.read_file<|channel|>commentary" || name === "repo_browser.read_file__channel__commentary" || name === "repo_browser.open_file<|channel|>commentary" || name === "repo_browser.open_file__channel__commentary") {name = "read_file";}

                    if (name === "repo_browser.write_file" || name === "repo_browser.write_file<|channel|>commentary" || name === "repo_browser.write_file__channel__commentary") {name = "write_file";}

                    if (name === "repo_browser.read_file_lines" || name === "repo_browser.read_file_lines<|channel|>commentary" || name === "repo_browser.read_file_lines__channel__commentary") {name = "read_file_lines";}

                    if (name === "repo_browser.list_files" || name === "repo_browser.list_files<|channel|>commentary" || name === "repo_browser.list_files__channel__commentary") {name = "list_files_recursive";}

                    if (name === "repo_browser.print_tree" || name === "repo_browser.print_tree<|channel|>commentary" || name === "repo_browser.print_tree__channel__commentary") {name = "list_files_recursive";}

                    if (name === "repo_browser.list_directory" || name === "repo_browser.ls" || name === "repo_browser.list_directory<|channel|>commentary" || name === "repo_browser.list_directory__channel__commentary" || name === "repo_browser.ls<|channel|>commentary" || name === "repo_browser.ls__channel__commentary") {name = "list_directory";}

                    if (name === "repo_browser.search" || name === "repo_browser.search<|channel|>commentary" || name === "repo_browser.search__channel__commentary") {name = "search_codebase";}

                    if (name === "repo_browser.rm" || name === "repo_browser.rm<|channel|>commentary" || name === "repo_browser.rm__channel__commentary") {name = "delete_file";}              if (name === "repo_browser.web_search") {name = "web_search";}
              if (name === "repo_browser.fetch_url") {name = "fetch_url";}
            }
      const rawArguments: string | undefined = isChatStyle
        ? (toolCall as any).function?.arguments
        : (toolCall as any).arguments;

      this.currentActiveToolName = name;
      this.currentActiveToolRawArguments = rawArguments;

      const callId: string = (toolCall as any).id || (toolCall as any).call_id;

      const toolCallKey = `${name}:${rawArguments}`;
      const history = this.toolCallHistory.get(toolCallKey) || { count: 0 };

      if (process.env["DEBUG"] === "1") {
        log(`[DEBUG] Tool Call: ${name}`);
        log(`[DEBUG] Arguments: ${rawArguments}`);
      }

      const result = parseToolCallArguments(rawArguments ?? "{}");
      if (isLoggingEnabled()) {
        log(
          `handleFunctionCall(): name=${
            name ?? "undefined"
          } callId=${callId} args=${rawArguments} count=${history.count}`,
        );
      }

      if (history.count >= 2) {
        return [
          {
            role: "tool",
            tool_call_id: callId,
            content: JSON.stringify({
              output: `Error: Loop detected. This exact tool call has been attempted ${history.count} times already and failed with: "${history.lastError}". Please stop and ask the user for clarification instead of retrying again.`,
              metadata: { exit_code: 1, duration_seconds: 0, loop_detected: true },
            }),
          } as ChatCompletionMessageParam,
        ];
      }

      if (!result.success) {
        try {
          const provider = this.config.provider || "unknown";
          appendFileSync("opencodex.error.log", `[${new Date().toISOString()}] Provider: ${provider}, Model: ${this.model}\nTool Argument Parsing Failed: ${name}\nArguments: ${rawArguments}\nError: ${result.error}\n\n`);
        } catch { /* ignore logging errors */ }
        return [
          {
            role: "tool",
            tool_call_id: callId,
            content: JSON.stringify({
              output: result.error,
              metadata: { exit_code: 1, duration_seconds: 0 },
            }),
          } as ChatCompletionMessageParam,
        ];
      }

      const args = (result as any).args;
      const outputItem: ChatCompletionMessageParam = {
        role: "tool",
        tool_call_id: callId,
        content: "no function found",
      };

      let outputText: string;
      let metadata: Record<string, unknown>;
      let additionalItems: Array<ChatCompletionMessageParam> | undefined;

              const ctx: AgentContext = {
                config: this.config,
                approvalPolicy: this.approvalPolicy,
                execAbortController: this.execAbortController,
                getCommandConfirmation: this.getCommandConfirmation,
                onItem: this.onItem,
                onFileAccess: this.onFileAccess,
                oai: this.oai,
                model: this.model,
                agent: this,
              };
      if (
        (name === "container.exec" ||
          name === "shell" ||
          name === "apply_patch" ||
          name === "repo_browser.exec") &&
        args
      ) {
        const result = await handleExecCommand(
          args,
          this.config,
          this.approvalPolicy,
          this.getCommandConfirmation,
          this.execAbortController?.signal,
          (chunk) => {
            // Emit a "thinking" update with partial output
            this.onItem({
              role: "tool",
              tool_call_id: callId,
              content: JSON.stringify({
                output: chunk,
                metadata: { exit_code: undefined, duration_seconds: 0 },
                streaming: true,
              }),
            });
          },
        );
        outputText = result.outputText;
        metadata = result.metadata;
        additionalItems = result.additionalItems;

        // --- AUTO-CORRECTION LOOP for apply_patch ---
        if (name === "apply_patch" && (args as any).patch) {
          const { identify_files_needed, identify_files_added } = await import("./apply-patch.js");
          const affectedFiles = [
            ...identify_files_needed((args as any).patch),
            ...identify_files_added((args as any).patch)
          ];
          
          for (const file of affectedFiles) {
            this.onFileAccess?.(file);
          }

          if (metadata["exit_code"] === 0) {
            for (const file of affectedFiles) {
              const validation = await validateFileSyntax(file);
              if (!validation.isValid) {
                outputText = `Error: The patch was applied but file "${file}" now contains syntax errors:\n${validation.error}\nPlease fix the errors and apply a new patch.`;
                metadata["exit_code"] = 1;
                metadata["syntax_error"] = true;
                break;
              }
            }
          }
        }
      } else if (name === "search_codebase") {
        const result = await handlers.handleSearchCodebase(ctx, rawArguments ?? "{}");
        outputText = result.outputText;
        metadata = result.metadata;
        additionalItems = result.additionalItems;
      } else if (name === "persistent_memory") {
        const result = await handlers.handlePersistentMemory(ctx, rawArguments ?? "{}");
        outputText = result.outputText;
        metadata = result.metadata;
        additionalItems = result.additionalItems;
      } else if (name === "summarize_memory") {
        const result = await handlers.handleSummarizeMemory();
        outputText = result.outputText;
        metadata = result.metadata;
      } else if (name === "query_memory") {
        const result = await handlers.handleQueryMemory(rawArguments ?? "{}");
        outputText = result.outputText;
        metadata = result.metadata;
      } else if (name === "forget_memory") {
        const result = await handlers.handleForgetMemory(rawArguments ?? "{}");
        outputText = result.outputText;
        metadata = result.metadata;
      } else if (name === "maintain_memory") {
        const result = await handlers.handleMaintainMemory(ctx);
        outputText = result.outputText;
        metadata = result.metadata;
      } else if (name === "read_file_lines") {
        const result = await handlers.handleReadFileLines(ctx, rawArguments ?? "{}");
        outputText = result.outputText;
        metadata = result.metadata;
        additionalItems = result.additionalItems;
      } else if (name === "list_files_recursive") {
        const result = await handlers.handleListFilesRecursive(ctx, rawArguments ?? "{}");
        outputText = result.outputText;
        metadata = result.metadata;
        additionalItems = result.additionalItems;
      } else if (name === "read_file") {
        const result = await handlers.handleReadFile(ctx, rawArguments ?? "{}");
        outputText = result.outputText;
        metadata = result.metadata;
        additionalItems = result.additionalItems;
      } else if (name === "write_file") {
        const result = await handlers.handleWriteFile(ctx, rawArguments ?? "{}");
        outputText = result.outputText;
        metadata = result.metadata;
        additionalItems = result.additionalItems;
      } else if (name === "delete_file") {
        const result = await handlers.handleDeleteFile(ctx, rawArguments ?? "{}");
        outputText = result.outputText;
        metadata = result.metadata;
        additionalItems = result.additionalItems;
      } else if (name === "list_directory") {
        const result = await handlers.handleListDirectory(ctx, rawArguments ?? "{}");
        outputText = result.outputText;
        metadata = result.metadata;
        additionalItems = result.additionalItems;
      } else if (name === "web_search") {
        const result = await handlers.handleWebSearch(ctx, rawArguments ?? "{}");
        outputText = result.outputText;
        metadata = result.metadata;
      } else if (name === "fetch_url") {
        const result = await handlers.handleFetchUrl(ctx, rawArguments ?? "{}");
        outputText = result.outputText;
        metadata = result.metadata;
      } else if (name === "semantic_search") {
        const result = await handlers.handleSemanticSearch(ctx, rawArguments ?? "{}");
        outputText = result.outputText;
        metadata = result.metadata;
      } else if (name === "index_codebase") {
        if (process.env["DEBUG"] === "1") {
          log(`Tool call: index_codebase invoked`);
        }
        this.onItem({
          role: "assistant",
          content: "Indexing codebase... this might take a while depending on the size.",
        });
        let totalIndexed = 0;
        await this.indexCodebase((curr, total, file) => {
          totalIndexed = total;
          const progressMsg = `Indexing progress: ${curr}/${total} - ${file}`;
          if (curr % 10 === 0) {
            log(progressMsg);
          }
          // Update UI with current progress
          this.onPartialUpdate?.("", progressMsg, "index_codebase", { current: curr, total, file });
        });
        // Clear progress from thinking indicator
        this.onPartialUpdate?.("", "", undefined, undefined);
        outputText = `Codebase indexing complete. Indexed ${totalIndexed} files.`;
        metadata = { exit_code: 0, count: totalIndexed };
      } else {
        return [outputItem];
      }

      outputItem.content = JSON.stringify({ output: outputText, metadata });

      // Update history for loop detection
      if (metadata["exit_code"] !== 0) {
        try {
          const provider = this.config.provider || "unknown";
          appendFileSync("opencodex.error.log", `[${new Date().toISOString()}] Provider: ${provider}, Model: ${this.model}\nTool Execution Failed: ${name}\nArguments: ${rawArguments}\nExit Code: ${metadata["exit_code"]}\nOutput: ${outputText}\n\n`);
        } catch { /* ignore logging errors */ }
        
        this.toolCallHistory.set(toolCallKey, {
          count: history.count + 1,
          lastError: outputText.slice(0, 200), // Store a snippet of the error
        });
      } else {
        // If it succeeded, we can clear it from history or at least reset count
        this.toolCallHistory.delete(toolCallKey);
      }

      const callResults: Array<ChatCompletionMessageParam> = [outputItem];
      if (additionalItems) {
        callResults.push(...additionalItems);
      }
      this.currentActiveToolName = undefined;
      this.currentActiveToolRawArguments = undefined;
      return callResults;
    });

    const allCallResults = await Promise.all(toolCallPromises);
    for (const callResults of allCallResults) {
      results.push(...callResults);
    }

    return results;
  }











  public async run(
    input: Array<ChatCompletionMessageParam>,
    prevItems: Array<ChatCompletionMessageParam> = [],
  ): Promise<void> {
    // ---------------------------------------------------------------------
    // Top‑level error wrapper so that known transient network issues like
    // \`ERR_STREAM_PREMATURE_CLOSE\` do not crash the entire CLI process.
    // Instead we surface the failure to the user as a regular system‑message
    // and terminate the current run gracefully. The calling UI can then let
    // the user retry the request if desired.
    // ---------------------------------------------------------------------

    try {
      if (this.terminated) {
        throw new Error("AgentLoop has been terminated");
      }
      // Record when we start "thinking" so we can report accurate elapsed time.
      // const thinkingStart = Date.now();
      // Bump generation so that any late events from previous runs can be
      // identified and dropped.
      const thisGeneration = ++this.generation;

      // Reset cancellation flag for a fresh run.
      this.canceled = false;
      // Create a fresh AbortController for this run so that tool calls from a
      // previous run do not accidentally get signalled.
      this.execAbortController = new AbortController();
      if (isLoggingEnabled()) {
        log(
          `AgentLoop.run(): new execAbortController created (${this.execAbortController.signal}) for generation ${this.generation}`,
        );
      }
      // NOTE: We no longer (re‑)attach an `abort` listener to `hardAbort` here.
      // A single listener that forwards the `abort` to the current
      // `execAbortController` is installed once in the constructor. Re‑adding a
      // new listener on every `run()` caused the same `AbortSignal` instance to
      // accumulate listeners which in turn triggered Node's
      // `MaxListenersExceededWarning` after ten invocations.

      // If there are unresolved function calls from a previously cancelled run
      // we have to emit dummy tool outputs so that the API no longer expects
      // them.  We prepend them to the user‑supplied input so they appear
      // first in the conversation turn.
      const abortOutputs: Array<ChatCompletionMessageParam> = [];
      if (this.pendingAborts.size > 0) {
        for (const id of this.pendingAborts) {
          abortOutputs.push({
            role: "tool",
            tool_call_id: id,
            content: JSON.stringify({
              output: "aborted",
              metadata: { exit_code: 1, duration_seconds: 0 },
            }),
          });
        }
        // Once converted the pending list can be cleared.
        this.pendingAborts.clear();
      }

      let turnInput = [...abortOutputs, ...input];

      this.onLoading(true);

      const staged: Array<ChatCompletionMessageParam | undefined> = [];
      const stageItem = (item: ChatCompletionMessageParam) => {
        // Ignore any stray events that belong to older generations.
        if (thisGeneration !== this.generation) {
          return;
        }

        // Store the item so the final flush can still operate on a complete list.
        // We'll nil out entries once they're delivered.
        this.onItem(item);
        staged.push(item);
        // // Instead of emitting synchronously we schedule a short‑delay delivery.
        // // This accomplishes two things:
        // //   1. The UI still sees new messages almost immediately, creating the
        // //      perception of real‑time updates.
        // //   2. If the user calls `cancel()` in the small window right after the
        // //      item was staged we can still abort the delivery because the
        // //      generation counter will have been bumped by `cancel()`.
        // setTimeout(() => {
        //   if (
        //     thisGeneration === this.generation &&
        //     !this.canceled &&
        //     !this.hardAbort.signal.aborted
        //   ) {
        //     this.onItem(item);
        //     // Mark as delivered so flush won't re-emit it
        //     staged[idx] = undefined;
        //   }
        // }, 10);
      };

      while (turnInput.length > 0) {
        if (this.canceled || this.hardAbort.signal.aborted) {
          this.onLoading(false);
          return;
        }
        // send request to openAI
        for (const item of turnInput) {
          stageItem(item);
        }

        // Send request to OpenAI with retry on timeout
        let stream: Stream<ChatCompletionChunk> | undefined = undefined;
        // Retry loop for transient errors. Up to MAX_RETRIES attempts.
        const MAX_RETRIES = 5;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            let reasoning: ReasoningEffort | undefined;
            if (
              this.model.startsWith("o") ||
              this.model.startsWith("openai/o")
            ) {
              reasoning = "high";
              // FIXME
              // if (this.model === "o3" || this.model === "o4-mini") {
              //   // @ts-expect-error waiting for API type update
              //   reasoning.summary = "auto";
              // }
            }
            const dryRunInfo = this.config.dryRun
              ? "\n\n--- DRY RUN ACTIVE ---\nThe system is currently in DRY RUN mode. Your changes will NOT be persisted to disk. Use this turn to plan, verify logic, and explain your intended changes to the user."
              : "";
            // If the instructions already contain the core identity string from the prefix,
            // we assume the user has fine-tuned the entire prompt and we should not
            // prepend the default prefix again. Also skip if enableDeepThinking is false.
            const basePrefix = (this.instructions?.includes("You are operating as and within OpenCodex") || this.config.enableDeepThinking === false)
              ? ""
              : prefix;

            // Context-Aware Memory Search: Inject relevant snippets from project memory
            let relevantMemory = "";
            const latestUserInput = input.findLast((i) => i.role === "user");
            const queryText = typeof latestUserInput?.content === "string" 
              ? latestUserInput.content 
              : Array.isArray(latestUserInput?.content) 
                ? latestUserInput.content.map(c => "text" in c ? c.text : "").join(" ") 
                : "";

            if (queryText && !this.config.skipSemanticMemory && this.semanticMemory.memoryExists()) {
              const snippets = await this.semanticMemory.findRelevant(queryText);
              if (snippets.length > 0) {
                relevantMemory = `\n\n--- Relevant Project Memory ---\n${snippets.join("\n")}`;
              }
            }

            const mergedInstructions = [basePrefix, this.instructions, relevantMemory, dryRunInfo]
              .filter(Boolean)
              .join("\n");
            if (isLoggingEnabled()) {
              log(
                `instructions (length ${mergedInstructions.length}): ${mergedInstructions}`,
              );
              log(`[HTTP] Request: ${this.config.provider} completion`);
              log(`[HTTP] Model: ${this.model}, Messages: ${prevItems.length + staged.length + 1}, Tools: ${tools.length}`);
            }

            if (this.config.provider === "google" || this.config.provider === "gemini") {
              const { contents, systemInstruction } = this.mapOpenAiToGoogleMessages([
                {
                  role: "system",
                  content: mergedInstructions,
                },
                ...prevItems,
                ...(staged.filter(
                  Boolean,
                ) as Array<ChatCompletionMessageParam>),
              ]);

              const googleTools = this.mapOpenAiToGoogleTools(tools.filter(tool => {
                if (tool.function.name === "web_search" || tool.function.name === "fetch_url") {
                  return !!this.config.enableWebSearch;
                }
                return true;
              }));

              const googleStream = await this.oai.models.generateContentStream({
                model: this.model,
                contents,
                config: {
                  systemInstruction,
                  tools: googleTools,
                }
              });
              stream = this.googleToOpenAiStream(googleStream) as any;
            } else {
              // eslint-disable-next-line no-await-in-loop
              stream = await this.oai.chat.completions.create({
                model: this.model,
                stream: true,
                messages: [
                  {
                    role: "system",
                    content: mergedInstructions,
                  },
                  ...prevItems,
                  ...(staged.filter(
                    Boolean,
                  ) as Array<ChatCompletionMessageParam>),
                ],
                reasoning_effort: reasoning,
                tools: tools.filter(tool => {
                  if (tool.function.name === "web_search" || tool.function.name === "fetch_url") {
                    return !!this.config.enableWebSearch;
                  }
                  return true;
                }),
              });
            }
            if (isLoggingEnabled()) {
              log(`[HTTP] Response: Stream started`);
            }
            break;
          } catch (error) {
            const isTimeout = error instanceof APIConnectionTimeoutError;
            // Lazily look up the APIConnectionError class at runtime to
            // accommodate the test environment's minimal OpenAI mocks which
            // do not define the class.  Falling back to `false` when the
            // export is absent ensures the check never throws.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ApiConnErrCtor = (OpenAI as any).APIConnectionError as  // eslint-disable-next-line @typescript-eslint/no-explicit-any
              | (new (...args: any) => Error)
              | undefined;
            const isConnectionError = ApiConnErrCtor
              ? error instanceof ApiConnErrCtor
              : false;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const errCtx = error as any;
            const status =
              errCtx?.status ?? errCtx?.httpStatus ?? errCtx?.statusCode;
            const isServerError = typeof status === "number" && status >= 500;
            if (
              (isTimeout || isServerError || isConnectionError) &&
              attempt < MAX_RETRIES
            ) {
              const provider = this.config.provider || "AI";
              log(
                `${provider} request failed (attempt ${attempt}/${MAX_RETRIES}), retrying...`,
              );
              continue;
            }

            const isTooManyTokensError =
              (errCtx.param === "max_tokens" ||
                (typeof errCtx.message === "string" &&
                  /max_tokens is too large/i.test(errCtx.message))) &&
              errCtx.type === "invalid_request_error";

            if (isTooManyTokensError) {
              this.onItem({
                role: "assistant",
                content: [
                  {
                    type: "text",
                    text: "⚠️  The current request exceeds the maximum context length supported by the chosen model. Please shorten the conversation, run /clear, or switch to a model with a larger context window and try again.",
                  },
                ],
              });
              this.onLoading(false);
              return;
            }

            const isRateLimit =
              status === 429 ||
              errCtx.code === "rate_limit_exceeded" ||
              errCtx.type === "rate_limit_exceeded" ||
              /rate limit/i.test(errCtx.message ?? "");
            if (isRateLimit) {
              if (attempt < MAX_RETRIES) {
                // Exponential backoff: base wait * 2^(attempt-1), or use suggested retry time
                // if provided.
                let delayMs = RATE_LIMIT_RETRY_WAIT_MS * 2 ** (attempt - 1);

                // Parse suggested retry time from error message, e.g., "Please try again in 1.3s"
                const msg = errCtx?.message ?? "";
                const m = /(?:retry|try) again in ([\d.]+)s/i.exec(msg);
                if (m && m[1]) {
                  const suggested = parseFloat(m[1]) * 1000;
                  if (!Number.isNaN(suggested)) {
                    delayMs = suggested;
                  }
                }
                log(
                  `${this.config.provider || "AI"} rate limit exceeded (attempt ${attempt}/${MAX_RETRIES}), retrying in ${Math.round(
                    delayMs,
                  )} ms...`,
                );
                // eslint-disable-next-line no-await-in-loop
                await new Promise((resolve) => setTimeout(resolve, delayMs));
                continue;
              } else {
                // We have exhausted all retry attempts. Surface a message so the user understands
                // why the request failed and can decide how to proceed (e.g. wait and retry later
                // or switch to a different model / account).

                const errorDetails = [
                  `Status: ${status || "unknown"}`,
                  `Code: ${errCtx.code || "unknown"}`,
                  `Type: ${errCtx.type || "unknown"}`,
                  `Message: ${errCtx.message || "unknown"}`,
                ].join(", ");

                this.onItem({
                  role: "assistant",
                  content: [
                    {
                      type: "text",
                      text: `⚠️  Rate limit reached. Error details: ${errorDetails}. Please try again later.`,
                    },
                  ],
                });

                this.onLoading(false);
                return;
              }
            }

            const isClientError =
              (typeof status === "number" &&
                status >= 400 &&
                status < 500 &&
                status !== 429) ||
              errCtx.code === "invalid_request_error" ||
              errCtx.type === "invalid_request_error";
            if (isClientError) {
              this.onItem({
                role: "assistant",
                content: [
                  {
                    type: "text",
                    // Surface the request ID when it is present on the error so users
                    // can reference it when contacting support or inspecting logs.
                    text: (() => {
                      const reqId =
                        (
                          errCtx as Partial<{
                            request_id?: string;
                            requestId?: string;
                          }>
                        )?.request_id ??
                        (
                          errCtx as Partial<{
                            request_id?: string;
                            requestId?: string;
                          }>
                        )?.requestId;

                      const errorDetails = [
                        `Status: ${status || "unknown"}`,
                        `Code: ${errCtx.code || "unknown"}`,
                        `Type: ${errCtx.type || "unknown"}`,
                        `Message: ${errCtx.message || "unknown"}`,
                      ].join(", ");
                      const provider = this.config.provider || "AI";
                      return `⚠️  ${provider} rejected the request${
                        reqId ? ` (request ID: ${reqId})` : ""
                      }. Error details: ${errorDetails}. Please verify your settings and try again.`;
                    })(),
                  },
                ],
              });
              this.onLoading(false);
              return;
            }
            throw error;
          }
        }
        turnInput = []; // clear turn input, prepare for function call results

        // If the user requested cancellation while we were awaiting the network
        // request, abort immediately before we start handling the stream.
        if (this.canceled || this.hardAbort.signal.aborted) {
          // `stream` is defined; abort to avoid wasting tokens/server work
          try {
            stream?.controller?.abort?.();
          } catch {
            /* ignore */
          }
          this.onLoading(false);
          return;
        }

        // Keep track of the active stream so it can be aborted on demand.
        this.currentStream = stream!;

        // guard against an undefined stream before iterating
        if (!stream) {
          this.onLoading(false);
          log("AgentLoop.run(): stream is undefined");
          return;
        }

        try {
          let message:
            | Extract<ChatCompletionMessageParam, { role: "assistant" }>
            | undefined;
          let messageProcessed = false;

          const finalizeMessage = async (
            msg: Extract<ChatCompletionMessageParam, { role: "assistant" }>,
          ) => {
            if (messageProcessed) return;
            messageProcessed = true;

            if (thisGeneration === this.generation && !this.canceled) {
              // If there's content but no tool_calls, try to extract one from the content.
              if (!msg?.tool_calls?.[0] && typeof msg?.content === "string") {
                const extracted = tryExtractToolCallsFromContent(msg.content);
                if (extracted.length > 0) {
                  (msg as any).tool_calls = extracted;
                  for (const call of extracted) {
                    if (call.id) {
                      this.pendingAborts.add(call.id);
                    }
                  }
                  msg.content = "";
                }
              }

              // Process completed tool calls
              if (msg?.tool_calls?.[0]) {
                msg.tool_calls = flattenToolCalls(msg.tool_calls);
                stageItem(msg);
                const results = await this.handleFunctionCall(msg);
                if (results.length > 0) {
                  turnInput.push(...results);
                }
              } else if (msg && Object.keys(msg).length > 0) {
                stageItem(msg);
              }
            }
          };

          // eslint-disable-next-line no-await-in-loop
          for await (const chunk of stream) {
            if (isLoggingEnabled()) {
              log(`AgentLoop.run(): completion chunk ${chunk.id}`);
            }
            const delta = chunk?.choices?.[0]?.delta;
            const content = delta?.content;
            const reasoning = (delta as any)?.reasoning_content;
            const tool_call = delta?.tool_calls?.[0];

            if (
              content ||
              reasoning ||
              this.currentActiveToolName ||
              this.currentActiveToolRawArguments
            ) {
              let parsedArgs: Record<string, any> | undefined;
              if (this.currentActiveToolRawArguments) {
                try {
                  parsedArgs = JSON.parse(this.currentActiveToolRawArguments);
                } catch {
                  parsedArgs = { raw: this.currentActiveToolRawArguments };
                }
              }
              this.onPartialUpdate?.(
                (message?.content as string) || "",
                reasoning,
                this.currentActiveToolName,
                parsedArgs,
              );
            }

            if (!message) {
              message = delta as Extract<
                ChatCompletionChunk,
                { role: "assistant" }
              >;
            } else {
              if (content) {
                message.content = (message.content ?? "") + content;
              }
              if (message && !message.tool_calls && tool_call) {
                // @ts-expect-error FIXME
                message.tool_calls = [tool_call];
              } else if (tool_call) {
                if (tool_call.function?.name) {
                  message.tool_calls![0]!.function.name +=
                    tool_call.function.name;
                }
                if (tool_call.function?.arguments) {
                  message.tool_calls![0]!.function.arguments +=
                    tool_call.function.arguments;
                }
              }
            }
            if (tool_call?.id) {
              this.pendingAborts.add(tool_call.id);
            }
            const finish_reason = chunk?.choices?.[0]?.finish_reason;
            if (finish_reason) {
              await finalizeMessage(message!);
            }
          }

          // Fallback: finalize message if stream ended without finish_reason
          if (message && !messageProcessed) {
            if (isLoggingEnabled()) {
              log("AgentLoop.run(): stream ended without finish_reason, triggering fallback finalization");
            }
            await finalizeMessage(message);
          }
        } catch (err: unknown) {
          // Gracefully handle an abort triggered via `cancel()` so that the
          // consumer does not see an unhandled exception.
          if (err instanceof Error && err.name === "AbortError") {
            if (!this.canceled) {
              // It was aborted for some other reason; surface the error.
              throw err;
            }
            this.onLoading(false);
            return;
          }
          // Suppress internal stack on JSON parse failures
          if (err instanceof SyntaxError) {
            this.onItem({
              role: "assistant",
              content:
                "⚠️ Failed to parse streaming response (invalid JSON). Please `/clear` to reset.",
            });
            this.onLoading(false);
            return;
          }
          // Handle OpenAI API quota errors
          if (
            err instanceof Error &&
            (err as { code?: string }).code === "insufficient_quota"
          ) {
            this.onItem({
              role: "assistant",
              content:
                "⚠️ Insufficient quota. Please check your billing details and retry.",
            });
            this.onLoading(false);
            return;
          }
          throw err;
        } finally {
          this.currentStream = null;
        }

        log(
          `Turn inputs (${turnInput.length}) - ${turnInput
            .map((i) => i.role)
            .join(", ")}`,
        );
      }

      // Flush staged items if the run concluded successfully (i.e. the user did
      // not invoke cancel() or terminate() during the turn).
      const flush = () => {
        // FIXME
        // if (
        //   !this.canceled &&
        //   !this.hardAbort.signal.aborted &&
        //   thisGeneration === this.generation
        // ) {
        //   // Only emit items that weren't already delivered above
        //   for (const item of staged) {
        //     if (item) {
        //       console.log("flush", item);
        //       this.onItem(item);
        //     }
        //   }
        // }

        // At this point the turn finished without the user invoking
        // `cancel()`.  Any outstanding function‑calls must therefore have been
        // satisfied, so we can safely clear the set that tracks pending aborts
        // to avoid emitting duplicate synthetic outputs in subsequent runs.
        this.pendingAborts.clear();
        // Now emit system messages recording the per‑turn *and* cumulative
        // thinking times so UIs and tests can surface/verify them.
        // const thinkingEnd = Date.now();

        // 1) Per‑turn measurement – exact time spent between request and
        //    response for *this* command.
        // this.onItem({
        //   role: "assistant",
        //   content: [
        //     {
        //       type: "text",
        //       text: `🤔  Thinking time: ${Math.round(
        //         (thinkingEnd - thinkingStart) / 1000
        //       )} s`,
        //     },
        //   ],
        // });

        // 2) Session‑wide cumulative counter so users can track overall wait
        //    time across multiple turns.
        // this.cumulativeThinkingMs += thinkingEnd - thinkingStart;
        // this.onItem({
        //   role: "assistant",
        //   content: [
        //     {
        //       type: "text",
        //       text: `⏱  Total thinking time: ${Math.round(
        //         this.cumulativeThinkingMs / 1000
        //       )} s`,
        //     },
        //   ],
        // });

        this.onLoading(false);
      };

      // Delay flush slightly to allow a near‑simultaneous cancel() to land.
      setTimeout(flush, 30);
      // End of main logic. The corresponding catch block for the wrapper at the
      // start of this method follows next.
    } catch (err) {
      // Handle known transient network/streaming issues so they do not crash the
      // CLI. We currently match Node/undici's `ERR_STREAM_PREMATURE_CLOSE`
      // error which manifests when the HTTP/2 stream terminates unexpectedly
      // (e.g. during brief network hiccups).

      const isPrematureClose =
        err instanceof Error &&
        // eslint-disable-next-line
        ((err as any).code === "ERR_STREAM_PREMATURE_CLOSE" ||
          err.message?.includes("Premature close"));

      if (isPrematureClose) {
        try {
          this.onItem({
            role: "assistant",
            content: [
              {
                type: "text",
                text: "⚠️  Connection closed prematurely while waiting for the model. Please try again.",
              },
            ],
          });
        } catch {
          /* no‑op – emitting the error message is best‑effort */
        }
        this.onLoading(false);
        return;
      }

      // -------------------------------------------------------------------
      // Catch‑all handling for other network or server‑side issues so that
      // transient failures do not crash the CLI. We intentionally keep the
      // detection logic conservative to avoid masking programming errors. A
      // failure is treated as retry‑worthy/user‑visible when any of the
      // following apply:
      //   • the error carries a recognised Node.js network errno ‑ style code
      //     (e.g. ECONNRESET, ETIMEDOUT …)
      //   • the OpenAI SDK attached an HTTP `status` >= 500 indicating a
      //     server‑side problem.
      //   • the error is model specific and detected in stream.
      // If matched we emit a single system message to inform the user and
      // resolve gracefully so callers can choose to retry.
      // -------------------------------------------------------------------

      const NETWORK_ERRNOS = new Set([
        "ECONNRESET",
        "ECONNREFUSED",
        "EPIPE",
        "ENOTFOUND",
        "ETIMEDOUT",
        "EAI_AGAIN",
      ]);

      const isNetworkOrServerError = (() => {
        if (!err || typeof err !== "object") {
          return false;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const e: any = err;

        // Direct instance check for connection errors thrown by the OpenAI SDK.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ApiConnErrCtor = (OpenAI as any).APIConnectionError as  // eslint-disable-next-line @typescript-eslint/no-explicit-any
          | (new (...args: any) => Error)
          | undefined;
        if (ApiConnErrCtor && e instanceof ApiConnErrCtor) {
          return true;
        }

        if (typeof e.code === "string" && NETWORK_ERRNOS.has(e.code)) {
          return true;
        }

        // When the OpenAI SDK nests the underlying network failure inside the
        // `cause` property we surface it as well so callers do not see an
        // unhandled exception for errors like ENOTFOUND, ECONNRESET …
        if (
          e.cause &&
          typeof e.cause === "object" &&
          NETWORK_ERRNOS.has((e.cause as { code?: string }).code ?? "")
        ) {
          return true;
        }

        if (typeof e.status === "number" && e.status >= 500) {
          return true;
        }

        // Fallback to a heuristic string match so we still catch future SDK
        // variations without enumerating every errno.
        if (
          typeof e.message === "string" &&
          /network|socket|stream/i.test(e.message)
        ) {
          return true;
        }

        return false;
      })();

      if (isNetworkOrServerError) {
        try {
          this.onItem({
            role: "assistant",
            content: [
              {
                type: "text",
                text: `⚠️  Network error while contacting ${this.config.provider || "AI"}. Please check your connection and try again.`,
              },
            ],
          });
        } catch {
          /* best‑effort */
        }
        this.onLoading(false);
        return;
      }

      const isInvalidRequestError = () => {
        if (!err || typeof err !== "object") {
          return false;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const e: any = err;

        const isInvalid =
          e.type === "invalid_request_error" ||
          (e.cause && e.cause.type === "invalid_request_error");

        if (isInvalid) {
          return true;
        }

        return false;
      };

      if (isInvalidRequestError()) {
        try {
          // Extract request ID and error details from the error object

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const e: any = err;

          const reqId =
            e.request_id ??
            (e.cause && e.cause.request_id) ??
            (e.cause && e.cause.requestId);

                                const errorDetails = [

                                  `Status: ${e.status || (e.cause && e.cause.status) || "unknown"}`,

                                  `Code: ${e.code || (e.cause && e.cause.code) || "unknown"}`,

                                  `Type: ${e.type || (e.cause && e.cause.type) || "unknown"}`,

                                  `Message: ${e.message || (e.cause && e.cause.message) || "unknown"}`,

                                ].join(", ");

          

                                const provider = this.config.provider || "AI";

                                const msgText = `⚠️  ${provider} rejected the request${

                                  reqId ? ` (request ID: ${reqId})` : ""

                                }. Error details: ${errorDetails}. Please verify your settings and try again.`;

          this.onItem({
            role: "assistant",
            content: [
              {
                type: "text",
                text: msgText,
              },
            ],
          });
        } catch {
          /* best-effort */
        }
        this.onLoading(false);
        return;
      }

      // Re‑throw all other errors so upstream handlers can decide what to do.
      throw err;
    }
  }

  // we need until we can depend on streaming events
  // @ts-expect-error Why was this needed?
  private async processEventsWithoutStreaming(
    output: Array<ChatCompletionMessageParam>,
    emitItem: (item: ChatCompletionMessageParam) => void,
  ): Promise<Array<ChatCompletionMessageParam>> {
    // If the agent has been canceled we should short‑circuit immediately to
    // avoid any further processing (including potentially expensive tool
    // calls). Returning an empty array ensures the main run‑loop terminates
    // promptly.
    if (this.canceled) {
      return [];
    }
    const turnInput: Array<ChatCompletionMessageParam> = [];
    for (const item of output) {
      if (item.role === "tool") {
        if (alreadyProcessedResponses.has(item.tool_call_id)) {
          continue;
        }
        alreadyProcessedResponses.add(item.tool_call_id);
        // eslint-disable-next-line no-await-in-loop
        const result = await this.handleFunctionCall(item);
        turnInput.push(...result);
      }
      emitItem(item);
    }
    return turnInput;
  }
}
