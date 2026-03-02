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
  tryExtractToolCallsFromContent,
} from "../parsers.js";
import { setCurrentModel, setSessionId, getSessionId } from "../session.js";
import { tools } from "./tool-definitions.js";
import { readFileSync, existsSync, lstatSync } from "fs";
import { randomUUID } from "node:crypto";

import OpenAI, { APIConnectionTimeoutError } from "openai";
import { GoogleGenAI } from "@google/genai";
import { prefix } from "./system-prompt.js";
import {
  type StateSnapshot,
  parseStateSnapshot,
  formatStateForPrompt,
} from "./state-manager.js";
import type {
  AgentContext,
  AgentLoopParams,
  CommandConfirmation,
  Task,
} from "./types.js";
export type { AgentContext, AgentLoopParams, CommandConfirmation, Task };
import { SemanticMemory } from "./semantic-memory.js";
import {
  mapOpenAiToGoogleMessages,
  mapOpenAiToGoogleTools,
  googleToOpenAiStream,
  sanitizeGoogleToolName,
} from "./google-utils.js";
import {
  mapOpenAiToAnthropicMessages,
  mapOpenAiToAnthropicTools,
  anthropicToOpenAiStream,
} from "./anthropic-utils.js";
import { handleFunctionCall } from "./function-call-handler.js";
import {
  createInvalidRequestErrorSystemMessage,
  createRateLimitErrorSystemMessage,
  createTokenLimitErrorSystemMessage,
  createNetworkErrorSystemMessage,
  isErrorClientError,
  isErrorNetworkOrServer,
  isErrorRateLimit,
  isErrorTooManyTokens,
} from "./error-handling.js";

// Wait time before retrying after rate limit errors (ms).
const RATE_LIMIT_RETRY_WAIT_MS = parseInt(
  process.env["OPENAI_RATE_LIMIT_RETRY_WAIT_MS"] || "2500",
  10,
);

import { PluginManager } from "./plugin-manager.js";

export class AgentLoop {
  private model: string;
  private instructions?: string;
  private approvalPolicy: ApprovalPolicy;
  private config: AppConfig;
  private pluginManager: PluginManager;

  // Using `InstanceType<typeof OpenAI>` sidesteps typing issues with the OpenAI package under
  // the TS 5+ `moduleResolution=bundler` setup. OpenAI client instance. We keep the concrete
  // type to avoid sprinkling `any` across the implementation while still allowing paths where
  // the OpenAI SDK types may not perfectly match. The `typeof OpenAI` pattern captures the
  // instance shape without resorting to `any`.
  private oai: any;

  private onItem: (item: ChatCompletionMessageParam) => void;
  private onPartialUpdate?: (
    content: string,
    reasoning?: string,
    activeToolName?: string,
    activeToolArguments?: Record<string, any>,
  ) => void;
  private onLoading: (loading: boolean) => void;
  private onFileAccess?: (path: string) => void;
  private onTasksUpdate?: (tasks: Task[]) => void;
  private onIndexingStatus?: (status: {
    indexing: boolean;
    current?: number;
    total?: number;
    file?: string;
  }) => void;
  private getCommandConfirmation: (
    command: Array<string>,
    applyPatch: ApplyPatchCommand | undefined,
  ) => Promise<CommandConfirmation>;

  private getUserChoice?: (
    prompt: string,
    choices?: Array<string>,
  ) => Promise<string>;

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
  private staged: Array<ChatCompletionMessageParam | undefined> = [];
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
  private lastThoughtSignature: string | undefined = undefined;
  private isFocused = false;

  private stateSnapshot: StateSnapshot = {};

  private onReset: () => void;

  /**
   * Files automatically pulled into context because they were mentioned 
   * in thoughts or modified.
   */
  private autoPulledFiles: Set<string> = new Set();

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
        this.autoPulledFiles.clear();
        this.stateSnapshot = {};
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

  public async indexCodebase(
    onProgress?: (current: number, total: number, file: string) => void,
  ): Promise<void> {
    this.onIndexingStatus?.({ indexing: true });
    try {
      await this.semanticMemory.indexCodebase((current, total, file) => {
        this.onIndexingStatus?.({ indexing: true, current, total, file });
        onProgress?.(current, total, file);
      });
    } finally {
      this.onIndexingStatus?.({ indexing: false });
    }
  }

  public async searchCode(query: string, limit: number = 5): Promise<any[]> {
    return this.semanticMemory.search(query, limit);
  }

  public hasIndex(): boolean {
    return this.semanticMemory.hasIndex();
  }

  private stageItem(item: ChatCompletionMessageParam, generation?: number) {
    // Ignore any stray events that belong to older generations.
    if (generation !== undefined && generation !== this.generation) {
      return;
    }

    // If this is a tool response, it's no longer pending an abort response.
    if (item.role === "tool" && "tool_call_id" in item && item.tool_call_id) {
      this.pendingAborts.delete(item.tool_call_id);
    }

    // Store the item so the final flush can still operate on a complete list.
    this.onItem(item);
    this.staged.push(item);
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

  /**
   * Automatically truncate history if it exceeds the maximum context size.
   * We keep the most recent messages, while always ensuring tool results
   * are preserved if their corresponding calls are still in history.
   */
  private truncateHistory(
    input: Array<ChatCompletionMessageParam>,
    prevItems: Array<ChatCompletionMessageParam>,
  ): {
    input: Array<ChatCompletionMessageParam>;
    prevItems: Array<ChatCompletionMessageParam>;
  } {
    const isAnthropic = this.config.provider === "anthropic";
    // More aggressive limit for Anthropic due to 30k TPM limits
    const maxMessages = this.config.contextSize || (isAnthropic ? 20 : 40);
    const totalMessages = input.length + prevItems.length;

    let newPrevItems = [...prevItems];

    // 1. Content Truncation: For older tool results, truncate huge outputs to save tokens
    // We only do this for messages that are "old" (not in the last 10 messages)
    if (newPrevItems.length > 10) {
      for (let i = 0; i < newPrevItems.length - 10; i++) {
        const item = newPrevItems[i];
        if (
          item &&
          item.role === "tool" &&
          typeof item.content === "string" &&
          item.content.length > 1000
        ) {
          try {
            const parsed = JSON.parse(item.content);
            if (
              parsed.output &&
              typeof parsed.output === "string" &&
              parsed.output.length > 500
            ) {
              parsed.output =
                parsed.output.slice(0, 500) +
                "\n... (truncated old result to save tokens)";
              newPrevItems[i] = { ...item, content: JSON.stringify(parsed) };
            }
          } catch {
            // Not JSON or differently structured, just truncate the string
            newPrevItems[i] = {
              ...item,
              content:
                item.content.slice(0, 1000) + "\n... (truncated old result)",
            };
          }
        }
      }
    }

    // 2. Message Count Truncation
    if (totalMessages > maxMessages) {
      if (isLoggingEnabled()) {
        log(
          `Truncating history: ${totalMessages} messages exceeds limit of ${maxMessages}`,
        );
      }

      const overflow = totalMessages - maxMessages;
      const truncateCount = Math.min(overflow, newPrevItems.length);
      newPrevItems = newPrevItems.slice(truncateCount);

      // Anthropic Specific: Ensure the first message in the history is NOT a 'tool' result
      // because it would be missing its preceding 'assistant' tool_use.
      while (newPrevItems.length > 0 && newPrevItems[0]?.role === "tool") {
        newPrevItems.shift();
      }
    }

    return { input, prevItems: newPrevItems };
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
    pluginManager,
    onItem,
    onPartialUpdate,
    onLoading,
    onFileAccess,
    onTasksUpdate,
    onIndexingStatus,
    onShellFocus,
    getCommandConfirmation,
    getUserChoice,
    onReset,
  }: AgentLoopParams & { config?: AppConfig }) {
    this.model = model;
    this.instructions = instructions;
    this.approvalPolicy = approvalPolicy;
    this.pluginManager = pluginManager;
    this.getUserChoice = getUserChoice;

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
    this.onTasksUpdate = onTasksUpdate;
    this.onIndexingStatus = onIndexingStatus;
    const originalOnShellFocus = onShellFocus;
    onShellFocus = (isFocused: boolean) => {
      this.isFocused = isFocused;
      originalOnShellFocus?.(isFocused);
    };
    this.getCommandConfirmation = getCommandConfirmation;
    this.onReset = onReset;
    this.sessionId = getSessionId() || randomUUID().replaceAll("-", "");
    // Configure OpenAI client with optional timeout (ms) from environment
    const timeoutMs = OPENAI_TIMEOUT_MS;
    const apiKey = this.config.apiKey;
    const baseURL = this.config.baseURL;
    if (
      this.config.provider === "google" ||
      this.config.provider === "gemini"
    ) {
      this.oai = new GoogleGenAI({
        apiKey: apiKey || "",
      });
    } else if (this.config.provider === "anthropic") {
      this.oai = null; // We use fetch directly for Anthropic
    } else {
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

    this.semanticMemory = new SemanticMemory(
      this.oai,
      this.config.provider,
      this.config.embeddingModel,
      this.config.apiKey,
    );

    setSessionId(this.sessionId);
    setCurrentModel(this.model);

    this.hardAbort = new AbortController();

    this.hardAbort.signal.addEventListener(
      "abort",

      () => this.execAbortController?.abort(),

      { once: true },
    );
  }

  public updateConfig(newConfig: AppConfig) {
    this.config = newConfig;
    if (newConfig.instructions !== undefined) {
      this.instructions = newConfig.instructions;
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
        // Safety: Filter out IDs that already have a response in the provided history.
        // This prevents "Duplicate value for 'tool_call_id'" errors if the turn
        // was interrupted after some tool calls were already successfully handled.
        const idsInHistory = new Set(
          prevItems
            .filter((m) => m.role === "tool" && "tool_call_id" in m)
            .map((m) => (m as any).tool_call_id),
        );

        for (const id of this.pendingAborts) {
          if (id && !idsInHistory.has(id)) {
            abortOutputs.push({
              role: "tool",
              tool_call_id: id,
              content: JSON.stringify({
                output: "aborted",
                metadata: { exit_code: 1, duration_seconds: 0 },
              }),
              ...(this.lastThoughtSignature
                ? ({ thought_signature: this.lastThoughtSignature } as any)
                : {}),
            });
          }
        }
        // Once converted the pending list can be cleared.
        this.pendingAborts.clear();
        this.lastThoughtSignature = undefined;
      }

      // Automatically manage context window size to prevent TPM/Token limits
      const truncated = this.truncateHistory(input, prevItems);

      const shouldRefresh = this.config.refreshSystemPrompt ?? true;

      // If we ARE refreshing, we filter out old system messages to avoid duplication.
      // If we ARE NOT refreshing, we keep the history as is (letting the first system message stay).
      const currentInput = shouldRefresh
        ? truncated.input.filter((m) => m.role !== "system")
        : truncated.input;
      const currentPrevItems = shouldRefresh
        ? truncated.prevItems.filter((m) => m.role !== "system")
        : truncated.prevItems;

      let turnInput = [...abortOutputs, ...currentInput];

      this.onLoading(true);
      this.staged = [];

      while (turnInput.length > 0) {
        if (this.canceled || this.hardAbort.signal.aborted) {
          this.onLoading(false);
          return;
        }
        // send request to openAI
        for (const item of turnInput) {
          this.stageItem(item, thisGeneration);
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
              this.model.startsWith("openai/o") ||
              this.model === "gpt-5.2"
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
            // prepend the default prefix again.
            const basePrefix = this.instructions?.includes(
              "You are operating as and within OpenCodex",
            )
              ? ""
              : prefix;

            // Context-Aware Memory Search: Inject relevant snippets from project memory
            let relevantMemory = "";
            const userMessages = currentInput.filter((i) => i.role === "user");
            const latestUserInput = userMessages[userMessages.length - 1];
            const queryText =
              typeof latestUserInput?.content === "string"
                ? latestUserInput.content
                : Array.isArray(latestUserInput?.content)
                  ? (latestUserInput.content as any)
                      .map((c: any) => ("text" in c ? c.text : ""))
                      .join(" ")
                  : "";

            if (
              queryText &&
              !this.config.skipSemanticMemory &&
              this.semanticMemory.memoryExists()
            ) {
              const snippets =
                await this.semanticMemory.findRelevant(queryText);
              if (snippets.length > 0) {
                relevantMemory = `\n\n--- Relevant Project Memory ---\n${snippets.join("\n")}`;
              }
            }

            // Project Context Injection: Inject dependencies and environment info
            let projectContext = "";
            try {
              if (existsSync("package.json")) {
                const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
                const deps = {
                  ...(pkg.dependencies || {}),
                  ...(pkg.devDependencies || {}),
                };
                projectContext += `\n\n--- Project Dependencies ---\n${JSON.stringify(deps, null, 2)}`;
              }
            } catch (e) {
              log(`Failed to inject project context: ${e}`);
            }

            // Pinned Files: Inject full contents of pinned files
            let pinnedFilesContent = "";
            const allFilesToPull = new Set([
              ...(this.config.pinnedFiles || []),
              ...this.autoPulledFiles,
            ]);

            if (allFilesToPull.size > 0) {
              const snippets = Array.from(allFilesToPull).map((path) => {
                if (existsSync(path)) {
                  try {
                    const content = readFileSync(path, "utf-8");
                    const label = this.autoPulledFiles.has(path)
                      ? "auto-pulled"
                      : "pinned";
                    return `--- ${label}-file: ${path} ---\n${content}`;
                  } catch (e) {
                    return `--- pinned-file: ${path} (Error reading: ${e}) ---`;
                  }
                }
                return `--- pinned-file: ${path} (Not found) ---`;
              });
              pinnedFilesContent = `\n\n--- Context Files ---\n${snippets.join("\n\n")}`;
            }

            const deepThinkingPrefix = this.config.enableDeepThinking
              ? "Enable deep thinking subroutine.\n\n"
              : "";

            const missionStateInfo = formatStateForPrompt(this.stateSnapshot);

            // 1. Stable Instructions (Identity, core protocol, user guidance)
            // These change rarely and should be at the top for maximum caching.
            const stableInstructions = [
              deepThinkingPrefix,
              basePrefix,
              this.instructions,
              dryRunInfo,
            ]
              .filter(Boolean)
              .join("\n");

            // 2. Dynamic Context (Real-time data about the project and mission)
            // These change frequently and are injected at the end of history for better model recency.
            const dynamicContext = [
              projectContext,
              pinnedFilesContent,
              missionStateInfo,
              relevantMemory,
            ]
              .filter(Boolean)
              .join("\n");

            const toolsToUse = [...tools, ...this.pluginManager.getAllDefinitions()];

            if (isLoggingEnabled()) {
              log(
                `stableInstructions (length ${stableInstructions.length}): ${stableInstructions}`,
              );
              log(
                `dynamicContext (length ${dynamicContext.length}): ${dynamicContext}`,
              );
              log(`[HTTP] Request: ${this.config.provider} completion`);
              log(
                `[HTTP] Model: ${this.model}, Messages: ${currentPrevItems.length + this.staged.length + 2}, Tools: ${toolsToUse.length}`,
              );
            }

            if (
              this.config.provider === "google" ||
              this.config.provider === "gemini"
            ) {
              const hasExistingSystem = currentPrevItems.some(
                (m) => m.role === "system",
              );
              const includeStable = shouldRefresh || !hasExistingSystem;

              const messagesToMap = [
                ...(includeStable
                  ? [{ role: "system" as const, content: stableInstructions }]
                  : []),
                ...currentPrevItems,
                ...(this.staged.filter(
                  Boolean,
                ) as Array<ChatCompletionMessageParam>),
                {
                  role: "system" as const,
                  content: `--- CURRENT PROJECT CONTEXT & MISSION STATE ---\n${dynamicContext}`,
                },
              ];

              const { contents, systemInstruction } =
                mapOpenAiToGoogleMessages(messagesToMap);

              const googleTools = mapOpenAiToGoogleTools(
                toolsToUse.filter((tool: any) => {
                  if (tool.function.name === "browse") {
                    return !!this.config.enableWebSearch;
                  }
                  return true;
                }),
                sanitizeGoogleToolName,
              );

              const googleStream = await this.oai.models.generateContentStream({
                model: this.model,
                contents,
                config: {
                  systemInstruction,
                  tools: googleTools,
                },
              });
              stream = googleToOpenAiStream(googleStream) as any;
            } else if (this.config.provider === "anthropic") {
              const { messages: anthropicMessages, system } =
                mapOpenAiToAnthropicMessages([
                  ...currentPrevItems,
                  ...(this.staged.filter(
                    Boolean,
                  ) as Array<ChatCompletionMessageParam>),
                ]);

              const anthropicTools = mapOpenAiToAnthropicTools(
                toolsToUse.filter((tool: any) => {
                  if (tool.function.name === "browse") {
                    return !!this.config.enableWebSearch;
                  }
                  return true;
                }),
              );

              const response = await fetch(
                `${this.config.baseURL}/v1/messages`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "x-api-key": this.config.apiKey || "",
                    "anthropic-version": "2023-06-01",
                  },
                  body: JSON.stringify({
                    model: this.model,
                    messages: anthropicMessages,
                    system: (() => {
                      const blocks: Array<any> = [
                        {
                          type: "text",
                          text: stableInstructions,
                          cache_control: { type: "ephemeral" },
                        },
                        {
                          type: "text",
                          text: `--- CURRENT PROJECT CONTEXT & MISSION STATE ---\n${dynamicContext}`,
                        },
                      ];
                      if (system) {
                        if (Array.isArray(system)) {
                          blocks.push(...system);
                        } else {
                          blocks.push({ type: "text", text: system });
                        }
                      }
                      return blocks;
                    })(),
                    tools: anthropicTools,
                    stream: true,
                    max_tokens: 8192,
                  }),
                  signal: this.execAbortController?.signal,
                },
              );

              if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const err = new Error(
                  `Anthropic API error: ${response.status} ${JSON.stringify(errorData)}`,
                );
                (err as any).status = response.status;
                const retryAfter = response.headers.get("retry-after");
                if (retryAfter) {
                  (err as any).retryAfter = retryAfter;
                }
                throw err;
              }

              const reader = response.body?.getReader();
              const decoder = new TextDecoder();

              const anthropicAsyncIterable = {
                async *[Symbol.asyncIterator]() {
                  let buffer = "";
                  while (true) {
                    const { done, value } = await reader!.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split("\n");
                    buffer = lines.pop() || "";
                    for (const line of lines) {
                      if (line.startsWith("data: ")) {
                        const data = line.slice(6);
                        if (data === "[DONE]") return;
                        try {
                          yield JSON.parse(data);
                        } catch (e) {
                          log(`Failed to parse Anthropic stream chunk: ${e}`);
                        }
                      }
                    }
                  }
                },
              };

              stream = anthropicToOpenAiStream(anthropicAsyncIterable) as any;
            } else {
              const hasExistingSystem = currentPrevItems.some(
                (m) => m.role === "system",
              );
              const includeStable = shouldRefresh || !hasExistingSystem;

              const finalMessages = [
                ...(includeStable
                  ? [{ role: "system" as const, content: stableInstructions }]
                  : []),
                ...currentPrevItems,
                ...(this.staged.filter(
                  Boolean,
                ) as Array<ChatCompletionMessageParam>),
                {
                  role: "system",
                  content: `--- CURRENT PROJECT CONTEXT & MISSION STATE ---\n${dynamicContext}`,
                },
              ];

              // eslint-disable-next-line no-await-in-loop
              stream = await this.oai.chat.completions.create({
                model: this.model,
                stream: true,
                messages: finalMessages,
                reasoning_effort: reasoning,
                tools: toolsToUse.filter((tool: any) => {
                  if (tool.function.name === "browse") {
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
            const isNetworkError = isErrorNetworkOrServer(error);
            if (
              isTimeout ||
              isServerError ||
              isConnectionError ||
              isNetworkError
            ) {
              if (attempt < MAX_RETRIES) {
                const provider = this.config.provider || "AI";
                const details =
                  (error as any).code || (error as any).message || "Unknown";
                log(
                  `${provider} request failed (attempt ${attempt}/${MAX_RETRIES}, details: ${details}), retrying...`,
                );
                continue;
              } else if (this.getUserChoice) {
                const provider = this.config.provider || "AI";
                const details =
                  (error as any).code || (error as any).message || "Unknown";
                const prompt = `${provider} request failed after ${MAX_RETRIES} attempts (${details}). How would you like to proceed?`;
                const choices = ["Retry Now", "Switch Model", "Abort"];
                const choice = await this.getUserChoice(prompt, choices);

                if (choice === "Retry Now") {
                  attempt = 0; // Reset and try again
                  continue;
                } else if (choice === "Switch Model") {
                  // We can't easily trigger the overlay from here without a callback, 
                  // but we can ask the user to use /model or implement a specialized callback.
                  // For now, let's assume the UI will handle it if we return a specific signal 
                  // or if we just stop and let the user decide.
                  // Actually, let's just abort and show a message.
                  this.stageItem(
                    {
                      role: "assistant",
                      content: "Request failed. Please use `/model` to switch to a different model and try again.",
                    },
                    thisGeneration,
                  );
                  this.onLoading(false);
                  return;
                }
              }
            }

            if (isErrorTooManyTokens(error)) {
              this.stageItem(
                createTokenLimitErrorSystemMessage(),
                thisGeneration,
              );
              this.onLoading(false);
              return;
            }

            if (isErrorRateLimit(error)) {
              if (attempt < MAX_RETRIES) {
                // If the error message explicitly says "would exceed", it's a context length/TPM issue
                // that no amount of retrying will fix unless we reduce the prompt.
                const rawMsg = (error as any).message || "";
                if (
                  rawMsg.includes("would exceed") &&
                  (rawMsg.includes("tokens per minute") ||
                    rawMsg.includes("rate limit"))
                ) {
                  this.stageItem(
                    createTokenLimitErrorSystemMessage(),
                    thisGeneration,
                  );
                  this.onLoading(false);
                  return;
                }

                // Exponential backoff: base wait * 2^(attempt-1), or use suggested retry time
                // if provided.
                let delayMs = RATE_LIMIT_RETRY_WAIT_MS * 2 ** (attempt - 1);

                if ((error as any).retryAfter) {
                  const suggested =
                    parseFloat((error as any).retryAfter) * 1000;
                  if (!Number.isNaN(suggested)) {
                    delayMs = suggested;
                  }
                } else {
                  // Parse suggested retry time from error message, e.g., "Please try again in 1.3s"
                  const msg = errCtx?.message ?? "";
                  const m = /(?:retry|try) again in ([\d.]+)s/i.exec(msg);
                  if (m && m[1]) {
                    const suggested = parseFloat(m[1]) * 1000;
                    if (!Number.isNaN(suggested)) {
                      delayMs = suggested;
                    }
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
              } else if (this.getUserChoice) {
                const provider = this.config.provider || "AI";
                const details =
                  (error as any).code || (error as any).message || "Unknown";
                const prompt = `${provider} rate limit exceeded after ${MAX_RETRIES} attempts (${details}). How would you like to proceed?`;
                const choices = ["Retry Now", "Switch Model", "Abort"];
                const choice = await this.getUserChoice(prompt, choices);

                if (choice === "Retry Now") {
                  attempt = 0; // Reset and try again
                  continue;
                } else if (choice === "Switch Model") {
                  this.stageItem(
                    {
                      role: "assistant",
                      content: "Rate limit reached. Please use `/model` to switch to a different model and try again.",
                    },
                    thisGeneration,
                  );
                  this.onLoading(false);
                  return;
                }
              }

              // Default: exhaust all attempts
              this.stageItem(
                createRateLimitErrorSystemMessage(error),
                thisGeneration,
              );

              this.onLoading(false);
              return;
            }

            if (isErrorClientError(error)) {
              this.stageItem(
                createInvalidRequestErrorSystemMessage(
                  error,
                  this.config.provider,
                ),
                thisGeneration,
              );
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
          let lastFinishReason: string | null = null;

          const finalizeMessage = async (
            msg: Extract<ChatCompletionMessageParam, { role: "assistant" }>,
          ) => {
            if (messageProcessed) return;
            messageProcessed = true;

            if (this.lastThoughtSignature) {
              (msg as any).thought_signature = this.lastThoughtSignature;
            }

            if (thisGeneration === this.generation && !this.canceled) {
              // Extract Structured State Snapshot if present
              const content =
                typeof msg.content === "string" ? msg.content : "";
              const newSnapshot = parseStateSnapshot(content);
              if (newSnapshot) {
                this.stateSnapshot = { ...this.stateSnapshot, ...newSnapshot };

                // If the snapshot contains task_state, sync it with the UI TaskChecklist
                if (newSnapshot.task_state && this.onTasksUpdate) {
                  const tasks: Task[] = newSnapshot.task_state.map((line) => {
                    const status = line.includes("[DONE]")
                      ? "done"
                      : line.includes("[IN_PROGRESS]")
                        ? "in-progress"
                        : "todo";
                    const label = line
                      .replace(/\[(DONE|IN_PROGRESS|TODO)\]/, "")
                      .trim();
                    return { label, status };
                  });
                  this.onTasksUpdate(tasks);
                }
              }

              // Smart Context: Extract mentioned file paths (regex looking for paths like src/app.ts)
              // This enables "Automatic inclusion of files mentioned in thoughts".
              const pathRegex = /(?:^|\s|`|'|")([\w\/\.-]+\.[a-zA-Z0-9]{1,10})(?:$|\s|`|'|")/g;
              let match;
              while ((match = pathRegex.exec(content)) !== null) {
                const possiblePath = match[1]?.trim();
                if (possiblePath && existsSync(possiblePath) && lstatSync(possiblePath).isFile()) {
                  this.autoPulledFiles.add(possiblePath);
                }
              }

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
                }
              }

              // Process completed tool calls
              if (msg?.tool_calls?.[0]) {
                msg.tool_calls = flattenToolCalls(msg.tool_calls);
                this.stageItem(msg, thisGeneration);
                const ctx: AgentContext = {
                  config: this.config,
                  approvalPolicy: this.approvalPolicy,
                  execAbortController: this.execAbortController,
                  getCommandConfirmation: this.getCommandConfirmation,
                  getUserChoice: this.getUserChoice,
                  onItem: this.onItem,
                  onFileAccess: (path) => {
                    this.onFileAccess?.(path);
                    if (existsSync(path) && lstatSync(path).isFile()) {
                      this.autoPulledFiles.add(path);
                    }
                  },
                  onTasksUpdate: this.onTasksUpdate,
                  pluginManager: this.pluginManager,
                  oai: this.oai,
                  model: this.model,
                  agent: this,
                };
                const results = await handleFunctionCall(
                  ctx,
                  msg,
                  this.toolCallHistory,
                  this.onLoading,
                  this.onPartialUpdate,
                  this.isFocused,
                );
                this.currentActiveToolName = undefined;
                this.currentActiveToolRawArguments = undefined;
                if (results.length > 0) {
                  turnInput.push(...results);
                }
              } else if (msg && Object.keys(msg).length > 0) {
                this.stageItem(msg, thisGeneration);
              }
            }
          };

          // eslint-disable-next-line no-await-in-loop
          let chunkCount = 0;
          for await (const chunk of stream) {
            chunkCount++;
            if (isLoggingEnabled()) {
              log(
                `AgentLoop.run(): completion chunk ${chunk.id} (count: ${chunkCount})`,
              );
            }
            const delta = chunk?.choices?.[0]?.delta;
            const content = delta?.content;
            const reasoning = (delta as any)?.reasoning_content;
            const tool_calls = delta?.tool_calls;
            const thought_signature = (chunk?.choices?.[0] as any)
              ?.thought_signature;

            if (thought_signature) {
              this.lastThoughtSignature = thought_signature;
            }

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
              if (thought_signature) {
                (message as any).thought_signature = thought_signature;
              }
            } else {
              if (content) {
                message.content = (message.content ?? "") + content;
              }
              if (reasoning) {
                (message as any).reasoning_content =
                  ((message as any).reasoning_content ?? "") + reasoning;
              }
              if (thought_signature) {
                (message as any).thought_signature = thought_signature;
              }

              if (tool_calls) {
                if (!message.tool_calls) {
                  message.tool_calls = [];
                }

                for (const tool_call of tool_calls) {
                  const index = tool_call.index ?? 0;
                  if (!message.tool_calls[index]) {
                    message.tool_calls[index] = tool_call as any;
                  } else {
                    const tc = message.tool_calls[index] as any;
                    if (tool_call.function?.name) {
                      tc.function.name =
                        (tc.function.name || "") + tool_call.function.name;
                    }
                    if (tool_call.function?.arguments) {
                      tc.function.arguments =
                        (tc.function.arguments || "") +
                        tool_call.function.arguments;
                    }
                  }

                  if (thought_signature) {
                    (message.tool_calls[index] as any).thought_signature =
                      thought_signature;
                  }

                  if (tool_call.id) {
                    this.pendingAborts.add(tool_call.id);
                  }

                  // Update active tool info for UI (last tool call in chunk)
                  if (tool_call.function?.name) {
                    this.currentActiveToolName = tool_call.function.name;
                  }
                  if (tool_call.function?.arguments) {
                    this.currentActiveToolRawArguments =
                      tool_call.function.arguments;
                  }
                }
              }
            }
            const fr = chunk?.choices?.[0]?.finish_reason;
            if (fr) {
              lastFinishReason = fr;
            }
          }

          if (chunkCount === 0) {
            log("AgentLoop.run(): stream ended with ZERO chunks");
            this.onItem({
              role: "assistant",
              content:
                "⚠️ The model returned an empty response. This can happen due to safety filters or provider issues. Please try again or switch models.",
            });
          }

          // Finalize message after the entire stream is consumed
          if (message && !messageProcessed) {
            if (isLoggingEnabled()) {
              log(
                `AgentLoop.run(): stream ended (reason: ${lastFinishReason}), triggering message finalization`,
              );
            }

            // Clear partial data and give UI a moment to settle before potential confirmation boxes
            this.onPartialUpdate?.("", "", undefined, undefined);

            if (lastFinishReason === "length") {
              // If we stopped because of token limit, automatically queue a "Please continue"
              // but we still need to finalize the current partial message so it shows in history.
              await finalizeMessage(message);
              turnInput.push({
                role: "user",
                content:
                  "Please finish your previous response from exactly where you left off.",
              });
              continue; // Continue the while(turnInput.length > 0) loop
            }

            await new Promise((resolve) => setTimeout(resolve, 100));
            await finalizeMessage(message);
          } else if (!message && chunkCount > 0) {
            log(
              "AgentLoop.run(): stream had chunks but no message was constructed",
            );
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

      if (isErrorClientError(err)) {
        try {
          this.stageItem(
            createInvalidRequestErrorSystemMessage(err, this.config.provider),
          );
        } catch {
          /* best-effort */
        }
        this.onLoading(false);
        return;
      }

      if (isErrorNetworkOrServer(err)) {
        try {
          this.stageItem(
            createNetworkErrorSystemMessage(err, this.config.provider),
          );
        } catch {
          /* best‑effort */
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
        const ctx: AgentContext = {
          config: this.config,
          approvalPolicy: this.approvalPolicy,
          execAbortController: this.execAbortController,
          getCommandConfirmation: this.getCommandConfirmation,
          getUserChoice: this.getUserChoice,
          onItem: this.onItem,
          onFileAccess: this.onFileAccess,
          onTasksUpdate: this.onTasksUpdate,
          pluginManager: this.pluginManager,
          oai: this.oai,
          model: this.model,
          agent: this,
        };
        // eslint-disable-next-line no-await-in-loop
        const result = await handleFunctionCall(
          ctx,
          item,
          this.toolCallHistory,
          this.onLoading,
          this.onPartialUpdate,
          this.isFocused,
        );
        turnInput.push(...result);
      }
      emitItem(item);
    }
    return turnInput;
  }
}
