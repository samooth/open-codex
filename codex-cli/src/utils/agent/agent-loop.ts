import type { ReviewDecision } from "./review.js";
import type { ApplyPatchCommand, ApprovalPolicy } from "../../approvals.js";
import type { AppConfig } from "../config.js";
import type {
  ChatCompletionChunk,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions/completions.mjs";
import type { reasoningeffort } from "openai/resources.mjs";
import type { Stream } from "openai/streaming.mjs";

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from "fs";
import { join } from "path";
import { log, isLoggingEnabled } from "./log.js";
import { OPENAI_TIMEOUT_MS } from "../config.js";
import {
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
import { randomUUID } from "node:crypto";
import OpenAI, { APIConnectionTimeoutError } from "openai";
import { prefix } from "./system-prompt.js";
import { tools } from "./tool-definitions.js";
import * as handlers from "./tool-handlers.js";
import type { AgentContext, AgentLoopParams, CommandConfirmation } from "./types.js";

// Wait time before retrying after rate limit errors (ms).
const RATE_LIMIT_RETRY_WAIT_MS = parseInt(
  process.env["OPENAI_RATE_LIMIT_RETRY_WAIT_MS"] || "2500",
  10,
);

export type CommandConfirmation = {
  review: ReviewDecision;
  applyPatch?: ApplyPatchCommand | undefined;
  customDenyMessage?: string;
};

const alreadyProcessedResponses = new Set();

type AgentLoopParams = {
  model: string;
  config?: AppConfig;
  instructions?: string;
  approvalPolicy: ApprovalPolicy;
  onItem: (item: ChatCompletionMessageParam) => void;
  onLoading: (loading: boolean) => void;
  onReset: () => void;

  /** Called when the command is not auto-approved to request explicit user review. */
  getCommandConfirmation: (
    command: Array<string>,
    applyPatch: ApplyPatchCommand | undefined,
  ) => Promise<CommandConfirmation>;
};

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
  private oai: OpenAI;

  private onItem: (item: ChatCompletionMessageParam) => void;
  private onLoading: (loading: boolean) => void;
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

  private onReset: () => void;

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
    onLoading,
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
    this.onLoading = onLoading;
    this.getCommandConfirmation = getCommandConfirmation;
    this.onReset = onReset;
    this.sessionId = getSessionId() || randomUUID().replaceAll("-", "");
    // Configure OpenAI client with optional timeout (ms) from environment
    const timeoutMs = OPENAI_TIMEOUT_MS;
    const apiKey = this.config.apiKey;
    const baseURL = this.config.baseURL;
    this.oai = new OpenAI({
      // The OpenAI JS SDK only requires `apiKey` when making requests against
      // the official API.  When running unit‑tests we stub out all network
      // calls so an undefined key is perfectly fine.  We therefore only set
      // the property if we actually have a value to avoid triggering runtime
      // errors inside the SDK (it validates that `apiKey` is a non‑empty
      // string when the field is present).
      ...(apiKey ? { apiKey } : {}),
      ...(baseURL ? { baseURL } : {}),
      defaultHeaders: {
        originator: ORIGIN,
        version: CLI_VERSION,
        session_id: this.sessionId,
      },
      ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}),
    });

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
        name = name.split("---")[0];
        name = name.trim();

        // Map repo_browser aliases to standard names
        if (name === "repo_browser.exec") name = "shell";
        if (name === "repo_browser.read_file") name = "read_file";
        if (name === "repo_browser.write_file") name = "write_file";
        if (name === "repo_browser.read_file_lines") name = "read_file_lines";
        if (name === "repo_browser.list_files") name = "list_files_recursive";
        if (name === "repo_browser.print_tree") name = "list_files_recursive";
        if (name === "repo_browser.list_directory") name = "list_directory";
        if (name === "repo_browser.search") name = "search_codebase";
      }

      const rawArguments: string | undefined = isChatStyle
        ? (toolCall as any).function?.arguments
        : (toolCall as any).arguments;

      const callId: string = (toolCall as any).id || (toolCall as any).call_id;

      const toolCallKey = `${name}:${rawArguments}`;
      const history = this.toolCallHistory.get(toolCallKey) || { count: 0 };

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

      const args = result.args;
      const outputItem: ChatCompletionMessageParam = {
        role: "tool",
        tool_call_id: callId,
        content: "no function found",
      };

      let outputText: string;
      let metadata: Record<string, unknown>;
      let additionalItems: Array<ChatCompletionMessageParam> | undefined;

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
      } else if (name === "search_codebase") {
        const result = await this.handleSearchCodebase(rawArguments ?? "{}");
        outputText = result.outputText;
        metadata = result.metadata;
        additionalItems = result.additionalItems;
      } else if (name === "persistent_memory") {
        const result = await this.handlePersistentMemory(rawArguments ?? "{}");
        outputText = result.outputText;
        metadata = result.metadata;
        additionalItems = result.additionalItems;
      } else if (name === "summarize_memory") {
        const result = await this.handleSummarizeMemory();
        outputText = result.outputText;
        metadata = result.metadata;
      } else if (name === "read_file_lines") {
        const result = await this.handleReadFileLines(rawArguments ?? "{}");
        outputText = result.outputText;
        metadata = result.metadata;
        additionalItems = result.additionalItems;
      } else if (name === "list_files_recursive") {
        const result = await this.handleListFilesRecursive(rawArguments ?? "{}");
        outputText = result.outputText;
        metadata = result.metadata;
        additionalItems = result.additionalItems;
      } else if (name === "read_file") {
        const result = await this.handleReadFile(rawArguments ?? "{}");
        outputText = result.outputText;
        metadata = result.metadata;
        additionalItems = result.additionalItems;
      } else if (name === "write_file") {
        const result = await this.handleWriteFile(rawArguments ?? "{}");
        outputText = result.outputText;
        metadata = result.metadata;
        additionalItems = result.additionalItems;
      } else if (name === "delete_file") {
        const result = await this.handleDeleteFile(rawArguments ?? "{}");
        outputText = result.outputText;
        metadata = result.metadata;
        additionalItems = result.additionalItems;
      } else if (name === "list_directory") {
        const result = await this.handleListDirectory(rawArguments ?? "{}");
        outputText = result.outputText;
        metadata = result.metadata;
        additionalItems = result.additionalItems;
      } else {
        return [outputItem];
      }

      outputItem.content = JSON.stringify({ output: outputText, metadata });

      // Update history for loop detection
      if (metadata.exit_code !== 0) {
        this.toolCallHistory.set(toolCallKey, {
          count: history.count + 1,
          lastError: outputText.slice(0, 200), // Store a snippet of the error
        });
      } else {
        // If it succeeded, we can clear it from history or at least reset count
        this.toolCallHistory.delete(toolCallKey);
      }

      const callResults = [outputItem];
      if (additionalItems) {
        callResults.push(...additionalItems);
      }
      return callResults;
    });

    const allCallResults = await Promise.all(toolCallPromises);
    for (const callResults of allCallResults) {
      results.push(...callResults);
    }

    return results;
  }

  private async handleReadFile(rawArgs: string): Promise<{
    outputText: string;
    metadata: Record<string, unknown>;
    additionalItems?: Array<ChatCompletionMessageParam>;
  }> {
    try {
      const args = JSON.parse(rawArgs);
      const { path: filePath } = args;

      if (!filePath) {
        return {
          outputText: "Error: 'path' is required for read_file",
          metadata: { exit_code: 1 },
        };
      }

      const execResult = await handleExecCommand(
        { cmd: ["cat", filePath] },
        this.config,
        this.approvalPolicy,
        this.getCommandConfirmation,
        this.execAbortController?.signal,
      );

      if (execResult.outputText === "aborted") {
        return execResult;
      }

      const fullPath = join(process.cwd(), filePath);
      if (!existsSync(fullPath)) {
        return {
          outputText: `Error: File not found: ${filePath}`,
          metadata: { exit_code: 1 },
        };
      }

      const content = readFileSync(fullPath, "utf-8");
      return {
        outputText: content,
        metadata: { exit_code: 0, path: filePath, size: content.length },
      };
    } catch (err) {
      return {
        outputText: `Error reading file: ${String(err)}`,
        metadata: { exit_code: 1 },
      };
    }
  }

  private async handleWriteFile(rawArgs: string): Promise<{
    outputText: string;
    metadata: Record<string, unknown>;
    additionalItems?: Array<ChatCompletionMessageParam>;
  }> {
    try {
      const args = JSON.parse(rawArgs);
      const { path: filePath, content } = args;

      if (!filePath || content === undefined) {
        return {
          outputText: "Error: 'path' and 'content' are required for write_file",
          metadata: { exit_code: 1 },
        };
      }

      const execResult = await handleExecCommand(
        { cmd: ["write_file", filePath] }, // Synthetic command for authorization
        this.config,
        this.approvalPolicy,
        this.getCommandConfirmation,
        this.execAbortController?.signal,
      );

      if (execResult.outputText === "aborted") {
        return execResult;
      }

      if (this.config.dryRun) {
        return {
          outputText: `[Dry Run] Would write ${content.length} characters to ${filePath}`,
          metadata: { exit_code: 0, path: filePath, dry_run: true },
        };
      }

      const fullPath = join(process.cwd(), filePath);
      const parentDir = join(fullPath, "..");
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }

      writeFileSync(fullPath, content, "utf-8");
      return {
        outputText: `Successfully wrote ${content.length} characters to ${filePath}`,
        metadata: { exit_code: 0, path: filePath },
      };
    } catch (err) {
      return {
        outputText: `Error writing file: ${String(err)}`,
        metadata: { exit_code: 1 },
      };
    }
  }

  private async handleDeleteFile(rawArgs: string): Promise<{
    outputText: string;
    metadata: Record<string, unknown>;
    additionalItems?: Array<ChatCompletionMessageParam>;
  }> {
    try {
      const args = JSON.parse(rawArgs);
      const { path: filePath } = args;

      if (!filePath) {
        return {
          outputText: "Error: 'path' is required for delete_file",
          metadata: { exit_code: 1 },
        };
      }

      const execResult = await handleExecCommand(
        { cmd: ["rm", filePath] },
        this.config,
        this.approvalPolicy,
        this.getCommandConfirmation,
        this.execAbortController?.signal,
      );

      if (execResult.outputText === "aborted") {
        return execResult;
      }

      if (this.config.dryRun) {
        return {
          outputText: `[Dry Run] Would delete file: ${filePath}`,
          metadata: { exit_code: 0, path: filePath, dry_run: true },
        };
      }

      const fullPath = join(process.cwd(), filePath);
      if (!existsSync(fullPath)) {
        return {
          outputText: `Error: File not found: ${filePath}`,
          metadata: { exit_code: 1 },
        };
      }

      const fs = await import("fs");
      fs.unlinkSync(fullPath);
      return {
        outputText: `Successfully deleted ${filePath}`,
        metadata: { exit_code: 0, path: filePath },
      };
    } catch (err) {
      return {
        outputText: `Error deleting file: ${String(err)}`,
        metadata: { exit_code: 1 },
      };
    }
  }

  private async handleListDirectory(rawArgs: string): Promise<{
    outputText: string;
    metadata: Record<string, unknown>;
    additionalItems?: Array<ChatCompletionMessageParam>;
  }> {
    try {
      const args = JSON.parse(rawArgs);
      const { path: dirPath = "." } = args;

      const execResult = await handleExecCommand(
        { cmd: ["ls", dirPath] },
        this.config,
        this.approvalPolicy,
        this.getCommandConfirmation,
        this.execAbortController?.signal,
      );

      if (execResult.outputText === "aborted") {
        return execResult;
      }

      const fullPath = join(process.cwd(), dirPath);
      if (!existsSync(fullPath)) {
        return {
          outputText: `Error: Directory not found: ${dirPath}`,
          metadata: { exit_code: 1 },
        };
      }

      const entries = readdirSync(fullPath, { withFileTypes: true })
        .sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        });

      const resultText = entries
        .map(e => `${e.isDirectory() ? "dir: " : "file:"} ${e.name}`)
        .join("\n");

      return {
        outputText: resultText || "Directory is empty.",
        metadata: { exit_code: 0, path: dirPath, count: entries.length },
      };
    } catch (err) {
      return {
        outputText: `Error listing directory: ${String(err)}`,
        metadata: { exit_code: 1 },
      };
    }
  }

  private async handleSearchCodebase(rawArgs: string): Promise<{
    outputText: string;
    metadata: Record<string, unknown>;
    additionalItems?: Array<ChatCompletionMessageParam>;
  }> {
    try {
      const args = JSON.parse(rawArgs);
      const pattern = args.pattern || args.query;
      const { path: searchPath, include } = args;

      if (!pattern) {
        return {
          outputText: "Error: 'pattern' or 'query' is required for search_codebase",
          metadata: { exit_code: 1 },
        };
      }

      const rgArgs = ["rg", "--json", pattern];
      if (searchPath) {
        rgArgs.push(searchPath);
      }
      if (include) {
        rgArgs.push("-g", include);
      }

      const result = await handleExecCommand(
        {
          cmd: rgArgs,
          workdir: process.cwd(),
          timeoutInMillis: 30000,
        },
        this.config,
        this.approvalPolicy,
        this.getCommandConfirmation,
        this.execAbortController?.signal,
      );

      if (result.outputText === "aborted") {
        return result;
      }

      const { outputText, metadata } = result;

      // Process ripgrep JSON output to be more compact/useful for the model
      const lines = outputText.trim().split("\n");
      const results: Array<any> = [];

      for (const line of lines) {
        if (!line) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "match") {
            results.push({
              file: parsed.data.path.text,
              line: parsed.data.line_number,
              text: parsed.data.lines.text.trim(),
            });
          }
        } catch {
          // Skip invalid JSON lines
        }
      }

      if (results.length === 0 && metadata.exit_code !== 0 && metadata.exit_code !== 1) {
        return {
          outputText: `Error: search_codebase failed with exit code ${metadata.exit_code}. ${outputText.trim() || "Check if 'rg' (ripgrep) is installed."}`,
          metadata,
        };
      }

      return {
        outputText:
          results.length > 0
            ? JSON.stringify(results, null, 2)
            : "No matches found.",
        metadata: { ...metadata, match_count: results.length },
      };
    } catch (err) {
      return {
        outputText: `Error executing search: ${String(err)}`,
        metadata: { exit_code: 1 },
      };
    }
  }

  private async handlePersistentMemory(rawArgs: string): Promise<{
    outputText: string;
    metadata: Record<string, unknown>;
    additionalItems?: Array<ChatCompletionMessageParam>;
  }> {
    try {
      const args = JSON.parse(rawArgs);
      const { fact, category = "general" } = args;

      if (!fact) {
        return {
          outputText: "Error: 'fact' is required for persistent_memory",
          metadata: { exit_code: 1 },
        };
      }

      const entry = `[${category}] ${fact}`;
      const result = await handleExecCommand(
        { cmd: ["persistent_memory", entry] },
        this.config,
        this.approvalPolicy,
        this.getCommandConfirmation,
        this.execAbortController?.signal,
      );

      if (result.outputText === "aborted") {
        return result;
      }

      if (this.config.dryRun) {
        return {
          outputText: `[Dry Run] Would save fact: ${entry}`,
          metadata: { exit_code: 0, dry_run: true },
        };
      }

      const memoryDir = join(process.cwd(), ".codex");
      const memoryPath = join(memoryDir, "memory.md");

      if (!existsSync(memoryDir)) {
        mkdirSync(memoryDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().split("T")[0];
      const fullEntry = `\n- [${timestamp}] [${category}] ${fact}`;
      appendFileSync(memoryPath, fullEntry, "utf-8");

      return {
        outputText: `Fact saved to ${category}: ${fact}`,
        metadata: { exit_code: 0, path: memoryPath, category },
      };
    } catch (err) {
      return {
        outputText: `Error saving memory: ${String(err)}`,
        metadata: { exit_code: 1 },
      };
    }
  }

  private async handleSummarizeMemory(): Promise<{
    outputText: string;
    metadata: Record<string, unknown>;
  }> {
    try {
      const memoryPath = join(process.cwd(), ".codex", "memory.md");
      if (!existsSync(memoryPath)) {
        return {
          outputText: "No memory file found to summarize.",
          metadata: { exit_code: 0 },
        };
      }

      const content = readFileSync(memoryPath, "utf-8");
      // For now, we'll just return the content and tell the model to summarize it
      // In a more advanced implementation, we could perform an LLM-based summarization here.
      return {
        outputText: `Current Memory Contents:\n${content}\n\nPlease review and let me know if you want to consolidate or remove any outdated facts.`,
        metadata: { exit_code: 0, length: content.length },
      };
    } catch (err) {
      return {
        outputText: `Error summarizing memory: ${String(err)}`,
        metadata: { exit_code: 1 },
      };
    }
  }

  private async handleReadFileLines(rawArgs: string): Promise<{
    outputText: string;
    metadata: Record<string, unknown>;
    additionalItems?: Array<ChatCompletionMessageParam>;
  }> {
    try {
      const args = JSON.parse(rawArgs);
      const { path: filePath, start_line, end_line } = args;

      if (!filePath || start_line === undefined || end_line === undefined) {
        return {
          outputText:
            "Error: 'path', 'start_line', and 'end_line' are required for read_file_lines",
          metadata: { exit_code: 1 },
        };
      }

      const result = await handleExecCommand(
        { cmd: ["cat", filePath, `lines ${start_line}-${end_line}`] },
        this.config,
        this.approvalPolicy,
        this.getCommandConfirmation,
        this.execAbortController?.signal,
      );

      if (result.outputText === "aborted") {
        return result;
      }

      const fullPath = join(process.cwd(), filePath);
      if (!existsSync(fullPath)) {
        return {
          outputText: `Error: File not found: ${filePath}`,
          metadata: { exit_code: 1 },
        };
      }

      const content = readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");
      
      // start_line and end_line are 1-based
      const start = Math.max(0, start_line - 1);
      const end = Math.min(lines.length, end_line);
      
      const requestedLines = lines.slice(start, end);
      const resultText = requestedLines.join("\n");

      return {
        outputText: resultText,
        metadata: {
          exit_code: 0,
          start_line: start + 1,
          end_line: end,
          total_lines: lines.length,
        },
      };
    } catch (err) {
      return {
        outputText: `Error reading file lines: ${String(err)}`,
        metadata: { exit_code: 1 },
      };
    }
  }

  private async handleListFilesRecursive(rawArgs: string): Promise<{
    outputText: string;
    metadata: Record<string, unknown>;
    additionalItems?: Array<ChatCompletionMessageParam>;
  }> {
    try {
      const args = JSON.parse(rawArgs);
      const { path: startPath = ".", depth = 3 } = args;

      const result = await handleExecCommand(
        { cmd: ["ls", "-R", startPath] },
        this.config,
        this.approvalPolicy,
        this.getCommandConfirmation,
        this.execAbortController?.signal,
      );

      if (result.outputText === "aborted") {
        return result;
      }

      const fullStartPath = join(process.cwd(), startPath);
      if (!existsSync(fullStartPath)) {
        return {
          outputText: `Error: Path not found: ${startPath}`,
          metadata: { exit_code: 1 },
        };
      }

      const generateTree = async (
        dir: string,
        currentDepth: number,
      ): Promise<string> => {
        if (currentDepth > depth) return "";

        let dirents: Array<import("fs").Dirent> = [];
        try {
          dirents = readdirSync(dir, { withFileTypes: true });
        } catch {
          return "";
        }

        const entries = dirents
          .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
          .sort((a, b) => {
            if (a.isDirectory() && !b.isDirectory()) return -1;
            if (!a.isDirectory() && b.isDirectory()) return 1;
            return a.name.localeCompare(b.name);
          });

        const results = await Promise.all(
          entries.map(async (entry) => {
            const indent = "  ".repeat(currentDepth - 1);
            if (entry.isDirectory()) {
              let subtree = `${indent}dir: ${entry.name}/\n`;
              subtree += await generateTree(join(dir, entry.name), currentDepth + 1);
              return subtree;
            } else {
              return `${indent}file: ${entry.name}\n`;
            }
          }),
        );

        return results.join("");
      };

      const treeResult = await generateTree(fullStartPath, 1);

      return {
        outputText: treeResult || "No files found.",
        metadata: { exit_code: 0, path: startPath, depth },
      };
    } catch (err) {
      return {
        outputText: `Error listing files: ${String(err)}`,
        metadata: { exit_code: 1 },
      };
    }
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
            const mergedInstructions = [prefix, this.instructions, dryRunInfo]
              .filter(Boolean)
              .join("\n");
            if (isLoggingEnabled()) {
              log(
                `instructions (length ${mergedInstructions.length}): ${mergedInstructions}`,
              );
            }
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
              tools: [
                {
                  type: "function",
                  function: {
                    name: "apply_patch",
                    description: "Applies a unified diff patch to the codebase.",
                    strict: false,
                    parameters: {
                      type: "object",
                      properties: {
                        patch: {
                          type: "string",
                          description:
                            "The patch to apply, in unified diff format, wrapped in *** Begin Patch and *** End Patch markers.",
                        },
                      },
                      required: ["patch"],
                      additionalProperties: false,
                    },
                  },
                },
                {
                  type: "function",
                  function: {
                    name: "repo_browser.exec",
                    description: "Alias for shell command execution.",
                    strict: false,
                    parameters: {
                      type: "object",
                      properties: {
                        command: { type: "array", items: { type: "string" } },
                        cmd: { type: "array", items: { type: "string" } },
                        workdir: {
                          type: "string",
                          description: "The working directory for the command.",
                        },
                        timeout: {
                          type: "number",
                          description:
                            "The maximum time to wait for the command to complete in milliseconds.",
                        },
                      },
                      required: [],
                      additionalProperties: true,
                    },
                  },
                },
                {
                  type: "function",
                  function: {
                    name: "repo_browser.read_file_lines",
                    description: "Alias for read_file_lines.",
                    strict: false,
                    parameters: {
                      type: "object",
                      properties: {
                        path: { type: "string" },
                        start_line: { type: "number" },
                        end_line: { type: "number" },
                      },
                      required: ["path", "start_line", "end_line"],
                    },
                  },
                },
                {
                  type: "function",
                  function: {
                    name: "repo_browser.read_file<|channel|>commentary",
                    description: "Alias for read_file (legacy support).",
                    strict: false,
                    parameters: {
                      type: "object",
                      properties: {
                        path: { type: "string" },
                      },
                      required: ["path"],
                    },
                  },
                },
                {
                  type: "function",
                  function: {
                    name: "repo_browser.read_file",
                    description: "Alias for read_file.",
                    strict: false,
                    parameters: {
                      type: "object",
                      properties: {
                        path: { type: "string" },
                      },
                      required: ["path"],
                    },
                  },
                },
                {
                  type: "function",
                  function: {
                    name: "repo_browser.write_file",
                    description: "Alias for write_file.",
                    strict: false,
                    parameters: {
                      type: "object",
                      properties: {
                        path: { type: "string" },
                        content: { type: "string" },
                      },
                      required: ["path", "content"],
                    },
                  },
                },
                {
                  type: "function",
                  function: {
                    name: "repo_browser.print_tree",
                    description: "Alias for list_files_recursive.",
                    strict: false,
                    parameters: {
                      type: "object",
                      properties: {
                        path: { type: "string" },
                      },
                    },
                  },
                },
                {
                  type: "function",
                  function: {
                    name: "repo_browser.list_directory",
                    description: "Alias for list_directory.",
                    strict: false,
                    parameters: {
                      type: "object",
                      properties: {
                        path: { type: "string" },
                      },
                    },
                  },
                },
                {
                  type: "function",
                  function: {
                    name: "repo_browser.list_files",
                    description: "Alias for list_files_recursive.",
                    strict: false,
                    parameters: {
                      type: "object",
                      properties: {
                        path: { type: "string" },
                      },
                    },
                  },
                },
                {
                  type: "function",
                  function: {
                    name: "repo_browser.search",
                    description: "Alias for search_codebase.",
                    strict: false,
                    parameters: {
                      type: "object",
                      properties: {
                        pattern: { type: "string" },
                        query: { type: "string" },
                        path: { type: "string" },
                      },
                      required: [],
                      additionalProperties: true,
                    },
                  },
                },
                {
                  type: "function",
                  function: {
                    name: "shell",
                    description:
                      "Runs a shell command, and returns its output.",
                    strict: false,
                    parameters: {
                      type: "object",
                      properties: {
                        command: { type: "array", items: { type: "string" } },
                        workdir: {
                          type: "string",
                          description: "The working directory for the command.",
                        },
                        timeout: {
                          type: "number",
                          description:
                            "The maximum time to wait for the command to complete in milliseconds.",
                        },
                      },
                      required: ["command", "workdir", "timeout"],
                      additionalProperties: false,
                    },
                  },
                },
                {
                  type: "function",
                  function: {
                    name: "search_codebase",
                    description:
                      "Searches the codebase using ripgrep and returns results in a structured JSON format.",
                    strict: false,
                    parameters: {
                      type: "object",
                      properties: {
                        pattern: {
                          type: "string",
                          description: "The regex pattern to search for.",
                        },
                        path: {
                          type: "string",
                          description:
                            "Optional subdirectory to search within (default: root).",
                        },
                        include: {
                          type: "string",
                          description:
                            "Optional glob pattern for files to include (e.g., '*.ts').",
                        },
                      },
                      required: ["pattern"],
                      additionalProperties: false,
                    },
                  },
                },
                {
                  type: "function",
                  function: {
                    name: "persistent_memory",
                    description:
                      "Saves a fact about the project to a local file that will be injected into future sessions. Useful for project-specific details like ports, architecture choices, or common paths.",
                    strict: false,
                    parameters: {
                      type: "object",
                      properties: {
                        fact: {
                          type: "string",
                          description:
                            "The fact to remember (e.g., 'The frontend runs on port 3000').",
                        },
                        category: {
                          type: "string",
                          description:
                            "Optional category for the fact (e.g., 'architecture', 'dev-setup', 'api').",
                        },
                      },
                      required: ["fact"],
                      additionalProperties: false,
                    },
                  },
                },
                {
                  type: "function",
                  function: {
                    name: "read_file_lines",
                    description:
                      "Reads specific line ranges from a file. Useful for large files to avoid exceeding context limits.",
                    strict: false,
                    parameters: {
                      type: "object",
                      properties: {
                        path: {
                          type: "string",
                          description: "The path to the file to read.",
                        },
                        start_line: {
                          type: "number",
                          description: "The 1-based starting line number.",
                        },
                        end_line: {
                          type: "number",
                          description: "The 1-based ending line number (inclusive).",
                        },
                      },
                      required: ["path", "start_line", "end_line"],
                      additionalProperties: false,
                    },
                  },
                },
                {
                  type: "function",
                  function: {
                    name: "list_files_recursive",
                    description:
                      "Returns a tree-view structure of the project files. Useful for understanding project layout.",
                    strict: false,
                    parameters: {
                      type: "object",
                      properties: {
                        path: {
                          type: "string",
                          description: "The directory to list (default: root).",
                        },
                        depth: {
                          type: "number",
                          description: "Maximum depth to recurse (default: 3).",
                        },
                      },
                      required: [],
                      additionalProperties: false,
                    },
                  },
                },
                {
                  type: "function",
                  function: {
                    name: "summarize_memory",
                    description:
                      "Retrieves all stored facts from the project memory for review and summarization. Useful when the memory becomes too large.",
                    strict: false,
                    parameters: {
                      type: "object",
                      properties: {},
                      additionalProperties: false,
                    },
                  },
                },
                {
                  type: "function",
                  function: {
                    name: "read_file",
                    description: "Reads the full content of a file.",
                    strict: false,
                    parameters: {
                      type: "object",
                      properties: {
                        path: {
                          type: "string",
                          description: "The path to the file to read.",
                        },
                      },
                      required: ["path"],
                      additionalProperties: false,
                    },
                  },
                },
                {
                  type: "function",
                  function: {
                    name: "write_file",
                    description:
                      "Writes content to a file, creating any parent directories as needed. Overwrites if the file already exists.",
                    strict: false,
                    parameters: {
                      type: "object",
                      properties: {
                        path: {
                          type: "string",
                          description: "The path to the file to write.",
                        },
                        content: {
                          type: "string",
                          description: "The content to write to the file.",
                        },
                      },
                      required: ["path", "content"],
                      additionalProperties: false,
                    },
                  },
                },
                {
                  type: "function",
                  function: {
                    name: "delete_file",
                    description: "Deletes a file from the codebase.",
                    strict: false,
                    parameters: {
                      type: "object",
                      properties: {
                        path: {
                          type: "string",
                          description: "The path to the file to delete.",
                        },
                      },
                      required: ["path"],
                      additionalProperties: false,
                    },
                  },
                },
                {
                  type: "function",
                  function: {
                    name: "list_directory",
                    description:
                      "Lists the contents of a directory (non-recursive).",
                    strict: false,
                    parameters: {
                      type: "object",
                      properties: {
                        path: {
                          type: "string",
                          description:
                            "The directory to list (default: current working directory).",
                        },
                      },
                      required: [],
                      additionalProperties: false,
                    },
                  },
                },
              ],
            });
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
              log(
                `OpenAI request failed (attempt ${attempt}/${MAX_RETRIES}), retrying...`,
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
                  `OpenAI rate limit exceeded (attempt ${attempt}/${MAX_RETRIES}), retrying in ${Math.round(
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
                      return `⚠️  OpenAI rejected the request${
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
          // eslint-disable-next-line no-await-in-loop
          for await (const chunk of stream) {
            if (isLoggingEnabled()) {
              log(`AgentLoop.run(): completion chunk ${chunk.id}`);
            }
            const delta = chunk?.choices?.[0]?.delta;
            const content = delta?.content;
            const tool_call = delta?.tool_calls?.[0];
            if (!message) {
              message = delta as Extract<
                ChatCompletionChunk,
                { role: "assistant" }
              >;
            } else {
              if (content) {
                message.content = message.content ?? "";
                message.content += content;
              }
              if (message && !message.tool_calls && tool_call) {
                // @ts-expect-error FIXME
                message.tool_calls = [tool_call];
              } else {
                if (tool_call?.function?.name) {
                  message.tool_calls![0]!.function.name +=
                    tool_call.function.name;
                }
                if (tool_call?.function?.arguments) {
                  message.tool_calls![0]!.function.arguments +=
                    tool_call.function.arguments;
                }
              }
            }
            if (tool_call?.id) {
              // Track outstanding tool call so we can abort later if needed.
              // The item comes from the streaming response, therefore it has
              // either `id` (chat) or `call_id` (responses) – we normalise
              // by reading both.
              this.pendingAborts.add(tool_call.id);
            }
            const finish_reason = chunk?.choices?.[0]?.finish_reason;
            if (finish_reason) {
              if (thisGeneration === this.generation && !this.canceled) {
                // If there's content but no tool_calls, try to extract one from the content.
                // This is a fallback for models (e.g. some Ollama models) that don't
                // use the native tool-calling API correctly.
                if (
                  !message?.tool_calls?.[0] &&
                  typeof message?.content === "string"
                ) {
                  const extracted = tryExtractToolCallsFromContent(
                    message.content,
                  );
                  if (extracted.length > 0) {
                    (message as any).tool_calls = extracted;
                    // Track these tool call IDs so we can send an aborted response
                    // if the user cancels before we finish handling them.
                    for (const call of extracted) {
                      if (call.id) {
                        this.pendingAborts.add(call.id);
                      }
                    }
                    // Clear the content so it's not displayed as a regular message.
                    message.content = "";
                  }
                }

                // Process completed tool calls
                if (message?.tool_calls?.[0]) {
                  stageItem(message);
                  const results = await this.handleFunctionCall(message);
                  if (results.length > 0) {
                    // Add results to the next turn's input
                    turnInput.push(...results);
                  }
                } else if (message && Object.keys(message).length > 0) {
                  stageItem(message);
                }
              }
            }
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
          const msgText =
            "⚠️  Network error while contacting OpenAI. Please check your connection and try again.";
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

          const msgText = `⚠️  OpenAI rejected the request${
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

const prefix = `You are operating as and within OpenCodex, a terminal-based agentic coding assistant. It wraps LLM models to enable natural language interaction with a local codebase. You are expected to be precise, safe, and helpful.

You can:
- Receive user prompts, project context, and files.
- Stream responses and emit function calls (e.g., shell commands, code edits).
- Direct file operations: \`read_file\`, \`write_file\`, \`delete_file\`, and \`list_directory\`.
- Apply patches, run commands, and manage user approvals based on policy.
- Work inside a sandboxed, git-backed workspace with rollback support.
- Log telemetry so sessions can be replayed or inspected later.
- More details on your functionality are available at \`opencodex --help\`

The Codex CLI is open-sourced. Don't confuse yourself with the old Codex language model built by OpenAI many moons ago (this is understandably top of mind for you!). Within this context, OpenCodex refers to the open-source agentic coding interface.

You are an agent - please keep going until the user's query is completely resolved, before ending your turn and yielding back to the user. Only terminate your turn when you are sure that the problem is solved. NEVER simulate or type out tool responses (like JSON or XML observation blocks) yourself; let the system provide them after you call a tool. If you are not sure about file content or codebase structure pertaining to the user's request, use your tools to read files and gather the relevant information: do NOT guess or make up an answer.

### Efficiency & Safety
- **Parallelism**: You can and should call multiple tools in parallel (e.g., reading multiple files at once) by emitting multiple tool calls in a single response. This is significantly faster for information gathering.
- **Loop Protection**: If a command or tool call fails more than twice with the same error, **STOP immediately**. Do not retry a third time. Instead, explain the situation to the user, share the error, and ask for clarification or help. Blindly retrying failing commands is a waste of resources and unlikely to succeed without a different approach.
- **Context Management**: Use \`read_file_lines\` for large files to avoid blowing out your context window.
- **Dry Run**: If the system informs you that a "Dry Run" is active, be aware that your changes are not being persisted. Use this mode to plan and verify your logic.



Please resolve the user's task by editing and testing the code files in your current code execution session. You are a deployed coding agent. Your session allows for you to modify and run code. The repo(s) are already cloned in your working directory, and you must fully solve the problem for your answer to be considered correct.

You MUST adhere to the following criteria when executing the task:
- Working on the repo(s) in the current environment is allowed, even if they are proprietary.
- Analyzing code for vulnerabilities is allowed.
- Showing user code and tool call details is allowed.
- User instructions may overwrite the *CODING GUIDELINES* section in this developer message.
- Use the \`apply_patch\` shell command to edit existing files surgically.
- Use \`write_file\` to create new files or completely rewrite small files.
- Use \`read_file\` to read full contents of small files, and \`read_file_lines\` for larger ones.
- Use \`list_directory\` for a quick look at a directory's contents.
- If completing the user's task requires writing or modifying files:
    - Your code and final answer should follow these *CODING GUIDELINES*:
        - Fix the problem at the root cause rather than applying surface-level patches, when possible.
        - Avoid unneeded complexity in your solution.
            - Ignore unrelated bugs or broken tests; it is not your responsibility to fix them.
        - Update documentation as necessary.
        - Keep changes consistent with the style of the existing codebase. Changes should be minimal and focused on the task.
            - Use \`git log\` and \`git blame\` to search the history of the codebase if additional context is required; internet access is disabled.
        - NEVER add copyright or license headers unless specifically requested.
        - You do not need to \`git commit\` your changes; this will be done automatically for you.
        - If there is a .pre-commit-config.yaml, use \`pre-commit run --files ...\` to check that your changes pass the pre-commit checks. However, do not fix pre-existing errors on lines you didn't touch.
            - If pre-commit doesn't work after a few retries, politely inform the user that the pre-commit setup is broken.
        - Once you finish coding, you must
            - Check \`git status\` to sanity check your changes; revert any scratch files or changes.
            - Remove all inline comments you added as much as possible, even if they look normal. Check using \`git diff\`. Inline comments must be generally avoided, unless active maintainers of the repo, after long careful study of the code and the issue, will still misinterpret the code without the comments.
            - Check if you accidentally add copyright or license headers. If so, remove them.
            - Try to run pre-commit if it is available.
            - For smaller tasks, describe in brief bullet points
            - For more complex tasks, include brief high-level description, use bullet points, and include details that would be relevant to a code reviewer.
- If completing the user's task DOES NOT require writing or modifying files (e.g., the user asks a question about the code base):
    - Respond in a friendly tune as a remote teammate, who is knowledgeable, capable and eager to help with coding.
- When your task involves writing or modifying files:
    - Do NOT tell the user to "save the file" or "copy the code into a file" if you already created or modified the file using \`apply_patch\`. Instead, reference the file as already saved.
    - Do NOT show the full contents of large files you have already written, unless the user explicitly asks for them.
`;