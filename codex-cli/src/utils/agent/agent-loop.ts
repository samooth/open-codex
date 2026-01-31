import type { ReviewDecision } from "./review.js";
import type { ApplyPatchCommand, ApprovalPolicy } from "../../approvals.js";
import type { AppConfig } from "../config.js";
import type {
  ChatCompletionChunk,
  ChatCompletionMessageParam,
  ChatCompletionTool,
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
import { validateFileSyntax } from "./validate-file.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from "fs";
import { randomUUID } from "node:crypto";
import OpenAI, { APIConnectionTimeoutError } from "openai";
import { join } from "path";

// Wait time before retrying after rate limit errors (ms).
const RATE_LIMIT_RETRY_WAIT_MS = parseInt(
  process.env["OPENAI_RATE_LIMIT_RETRY_WAIT_MS"] || "2500",
  10,
);

const MAX_RETRIES = 5;

// Network error codes that warrant retry
const NETWORK_ERRNOS = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EAI_AGAIN",
]);

export type CommandConfirmation = {
  review: ReviewDecision;
  applyPatch?: ApplyPatchCommand | undefined;
  customDenyMessage?: string;
};

type AgentLoopParams = {
  model: string;
  config?: AppConfig;
  instructions?: string;
  approvalPolicy: ApprovalPolicy;
  onItem: (item: ChatCompletionMessageParam) => void;
  onPartialUpdate?: (
    content: string,
    reasoning?: string,
    activeToolName?: string,
    activeToolArguments?: Record<string, unknown>
  ) => void;
  onLoading: (loading: boolean) => void;
  onReset: () => void;
  getCommandConfirmation: (
    command: Array<string>,
    applyPatch: ApplyPatchCommand | undefined,
  ) => Promise<CommandConfirmation>;
};

// Tool definitions extracted for clarity
const TOOL_DEFINITIONS: Array<ChatCompletionTool> = [
  {
    type: "function",
    function: {
      name: "apply_patch",
      description: "Applies a unified diff patch to the codebase. The patch must be wrapped in '*** Begin Patch ***' and '*** End Patch ***' markers.",
      parameters: {
        type: "object",
        properties: {
          patch: {
            type: "string",
            description: "The patch to apply, in unified diff format, wrapped in *** Begin Patch and *** End Patch markers.",
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
      name: "shell",
      description: "Runs a shell command and returns its output.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "array", items: { type: "string" } },
          cmd: { type: "array", items: { type: "string" } },
          workdir: { type: "string", description: "The working directory for the command." },
          timeout: { type: "number", description: "Maximum time to wait in milliseconds." },
        },
        required: [],
        additionalProperties: true,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_codebase",
      description: "Searches the codebase using ripgrep and returns structured JSON results.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "The regex pattern to search for." },
          path: { type: "string", description: "Optional subdirectory to search within." },
          include: { type: "string", description: "Optional glob pattern (e.g., '*.ts')." },
        },
        required: ["pattern"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Reads the full content of a file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The path to the file to read." },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file_lines",
      description: "Reads specific line ranges from a file. Useful for large files to avoid context limits.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The path to the file." },
          start_line: { type: "number", description: "The 1-based starting line number." },
          end_line: { type: "number", description: "The 1-based ending line number (inclusive)." },
        },
        required: ["path", "start_line", "end_line"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Writes content to a file, creating parent directories as needed. Overwrites existing files.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The path to the file." },
          content: { type: "string", description: "The content to write." },
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
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The path to the file to delete." },
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
      description: "Lists the contents of a directory (non-recursive).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The directory to list (default: current directory)." },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files_recursive",
      description: "Returns a tree-view structure of project files. Useful for understanding project layout.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The directory to list (default: root)." },
          depth: { type: "number", description: "Maximum depth to recurse (default: 3)." },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "persistent_memory",
      description: "Saves a fact about the project to a local file for future sessions.",
      parameters: {
        type: "object",
        properties: {
          fact: { type: "string", description: "The fact to remember." },
          category: { type: "string", description: "Optional category (e.g., 'architecture')." },
        },
        required: ["fact"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "summarize_memory",
      description: "Retrieves all stored facts from project memory for review.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
];

export class AgentLoop {
  private model: string;
  private instructions?: string;
  private approvalPolicy: ApprovalPolicy;
  private config: AppConfig;
  private oai: OpenAI;
  private onItem: (item: ChatCompletionMessageParam) => void;
  private onPartialUpdate?: (
    content: string,
    reasoning?: string,
    activeToolName?: string,
    activeToolArguments?: Record<string, unknown>
  ) => void;
  private onLoading: (loading: boolean) => void;
  private getCommandConfirmation: (
    command: Array<string>,
    applyPatch: ApplyPatchCommand | undefined,
  ) => Promise<CommandConfirmation>;
  private onReset: () => void;

  private currentStream: Stream<ChatCompletionChunk> | null = null;
  private generation = 0;
  private execAbortController: AbortController | null = null;
  private canceled = false;
  private pendingAborts: Set<string> = new Set();
  private terminated = false;
  private hardAbort = new AbortController();
  private toolCallHistory: Map<string, { count: number; lastError?: string }> = new Map();
  private currentActiveToolName?: string;
  private currentActiveToolRawArguments?: string;
  private alreadyProcessedResponses: Set<string> = new Set();
  public sessionId: string;

  constructor({
    model,
    instructions,
    approvalPolicy,
    config,
    onItem,
    onPartialUpdate,
    onLoading,
    getCommandConfirmation,
    onReset,
  }: AgentLoopParams) {
    this.model = model;
    this.instructions = instructions;
    this.approvalPolicy = approvalPolicy;
    this.config = config ?? ({ model, instructions: instructions ?? "" } as AppConfig);
    this.onItem = onItem;
    this.onPartialUpdate = onPartialUpdate;
    this.onLoading = onLoading;
    this.getCommandConfirmation = getCommandConfirmation;
    this.onReset = onReset;
    this.sessionId = getSessionId() || randomUUID().replaceAll("-", "");

    const timeoutMs = OPENAI_TIMEOUT_MS;
    const apiKey = this.config.apiKey;
    const baseURL = this.config.baseURL;

    this.oai = new OpenAI({
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

    this.hardAbort.signal.addEventListener(
      "abort",
      () => this.execAbortController?.abort(),
      { once: true },
    );
  }

  public cancel(): void {
    if (this.terminated) return;

    if (isLoggingEnabled()) {
      log(`AgentLoop.cancel() invoked – generation=${this.generation}`);
    }

    this.currentStream?.controller?.abort?.();
    this.canceled = true;
    this.execAbortController?.abort();

    if (this.pendingAborts.size === 0) {
      try {
        this.toolCallHistory.clear();
        this.onReset();
      } catch {
        // ignore
      }
    }

    this.onLoading(false);
    this.generation += 1;

    if (isLoggingEnabled()) {
      log(`AgentLoop.cancel(): generation bumped to ${this.generation}`);
    }
  }

  public terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    this.hardAbort.abort();
    this.cancel();
  }

  private normalizeToolName(name: string): string {
    // Strip common model-specific suffixes
    name = name.split("<")[0]?.split("---")[0]?.trim() ?? name;

    // Map repo_browser aliases to standard names
    const aliases: Record<string, string> = {
      "repo_browser.exec": "shell",
      "repo_browser.read_file": "read_file",
      "repo_browser.write_file": "write_file",
      "repo_browser.read_file_lines": "read_file_lines",
      "repo_browser.list_files": "list_files_recursive",
      "repo_browser.print_tree": "list_files_recursive",
      "repo_browser.list_directory": "list_directory",
      "repo_browser.search": "search_codebase",
    };

    return aliases[name] || name;
  }

  private async handleFunctionCall(
    itemArg: ChatCompletionMessageParam,
  ): Promise<Array<ChatCompletionMessageParam>> {
    if (this.canceled || itemArg.role !== "assistant" || !itemArg.tool_calls) {
      return [];
    }

    const results: Array<ChatCompletionMessageParam> = [];

    const toolCallPromises = itemArg.tool_calls.map(async (toolCall) => {
      const toolCallAny = toolCall as any;
      let name = this.normalizeToolName(
        toolCallAny.function?.name || toolCallAny.name
      );
      const rawArguments = toolCallAny.function?.arguments || toolCallAny.arguments;
      const callId = toolCallAny.id || toolCallAny.call_id;

      this.currentActiveToolName = name;
      this.currentActiveToolRawArguments = rawArguments;

      const toolCallKey = `${name}:${rawArguments}`;
      const history = this.toolCallHistory.get(toolCallKey) || { count: 0 };

      if (isLoggingEnabled()) {
        log(`handleFunctionCall(): name=${name} callId=${callId} count=${history.count}`);
      }

      if (history.count >= 2) {
        return [{
          role: "tool",
          tool_call_id: callId,
          content: JSON.stringify({
            output: `Error: Loop detected. This tool call has been attempted ${history.count} times already and failed with: "${history.lastError}". Please stop and ask the user for clarification.`,
            metadata: { exit_code: 1, duration_seconds: 0, loop_detected: true },
          }),
        }];
      }

      const parseResult = parseToolCallArguments(rawArguments ?? "{}");
      if (!parseResult.success) {
        return [{
          role: "tool",
          tool_call_id: callId,
          content: JSON.stringify({
            output: parseResult.error,
            metadata: { exit_code: 1, duration_seconds: 0 },
          }),
        }];
      }

      let outputText: string;
      let metadata: Record<string, unknown>;
      let additionalItems: Array<ChatCompletionMessageParam> | undefined;

      try {
        switch (name) {
          case "shell":
          case "apply_patch": {
            if (!parseResult.args) {
              throw new Error("Missing arguments for shell/patch command");
            }
            const execResult = await handleExecCommand(
              parseResult.args,
              this.config,
              this.approvalPolicy,
              this.getCommandConfirmation,
              this.execAbortController?.signal,
              (chunk) => {
                this.onItem({
                  role: "tool",
                  tool_call_id: callId,
                  content: JSON.stringify({
                    output: chunk,
                    metadata: { exit_code: undefined, duration_seconds: 0, streaming: true },
                  }),
                });
              },
            );
            outputText = execResult.outputText;
            metadata = execResult.metadata;
            additionalItems = execResult.additionalItems;

            // Auto-correction for syntax errors after patch
            if (name === "apply_patch" && metadata["exit_code"] === 0) {
              const { identify_files_needed, identify_files_added } = await import("./apply-patch.js");
              const args = parseResult.args as any;
              if (args.patch) {
                const affectedFiles = [
                  ...identify_files_needed(args.patch),
                  ...identify_files_added(args.patch),
                ];
                for (const file of affectedFiles) {
                  const validation = await validateFileSyntax(file);
                  if (!validation.isValid) {
                    outputText = `Error: Patch applied but "${file}" has syntax errors:
${validation.error}
Please fix and reapply.`;
                    metadata["exit_code"] = 1;
                    metadata["syntax_error"] = true;
                    break;
                  }
                }
              }
            }
            break;
          }
          case "read_file":
            ({ outputText, metadata, additionalItems } = await this.handleReadFile(rawArguments ?? "{}"));
            break;
          case "write_file":
            ({ outputText, metadata, additionalItems } = await this.handleWriteFile(rawArguments ?? "{}"));
            break;
          case "delete_file":
            ({ outputText, metadata, additionalItems } = await this.handleDeleteFile(rawArguments ?? "{}"));
            break;
          case "list_directory":
            ({ outputText, metadata, additionalItems } = await this.handleListDirectory(rawArguments ?? "{}"));
            break;
          case "search_codebase":
            ({ outputText, metadata, additionalItems } = await this.handleSearchCodebase(rawArguments ?? "{}"));
            break;
          case "persistent_memory":
            ({ outputText, metadata, additionalItems } = await this.handlePersistentMemory(rawArguments ?? "{}"));
            break;
          case "summarize_memory":
            ({ outputText, metadata } = await this.handleSummarizeMemory());
            break;
          case "read_file_lines":
            ({ outputText, metadata, additionalItems } = await this.handleReadFileLines(rawArguments ?? "{}"));
            break;
          case "list_files_recursive":
            ({ outputText, metadata, additionalItems } = await this.handleListFilesRecursive(rawArguments ?? "{}"));
            break;
          default:
            return [{
              role: "tool",
              tool_call_id: callId,
              content: JSON.stringify({ output: "Unknown tool", metadata: { exit_code: 1 } }),
            }];
        }
      } catch (err) {
        outputText = `Error executing ${name}: ${String(err)}`;
        metadata = { exit_code: 1, error: String(err) };
      }

      // Update history for loop detection
      if (metadata["exit_code"] !== 0) {
        this.toolCallHistory.set(toolCallKey, {
          count: history.count + 1,
          lastError: outputText.slice(0, 200),
        });
      } else {
        this.toolCallHistory.delete(toolCallKey);
      }

      const callResults: Array<ChatCompletionMessageParam> = [{
        role: "tool",
        tool_call_id: callId,
        content: JSON.stringify({ output: outputText, metadata }),
      }];

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

  // Tool handlers
  private async handleReadFile(rawArgs: string) {
    try {
      const args = JSON.parse(rawArgs);
      const filePath = args.path;

      if (!filePath) {
        return { outputText: "Error: 'path' is required", metadata: { exit_code: 1 } };
      }

      const fullPath = join(process.cwd(), filePath);
      if (!existsSync(fullPath)) {
        return { outputText: `Error: File not found: ${filePath}`, metadata: { exit_code: 1 } };
      }

      const content = readFileSync(fullPath, "utf-8");
      return {
        outputText: content,
        metadata: { exit_code: 0, path: filePath, size: content.length },
      };
    } catch (err) {
      return { outputText: `Error reading file: ${String(err)}`, metadata: { exit_code: 1 } };
    }
  }

  private async handleWriteFile(rawArgs: string) {
    try {
      const args = JSON.parse(rawArgs);
      const { path: filePath, content } = args;

      if (!filePath || content === undefined) {
        return { outputText: "Error: 'path' and 'content' are required", metadata: { exit_code: 1 } };
      }

      if (this.config.dryRun) {
        return {
          outputText: `[Dry Run] Would write ${content.length} chars to ${filePath}`,
          metadata: { exit_code: 0, path: filePath, dry_run: true },
        };
      }

      const fullPath = join(process.cwd(), filePath);
      const parentDir = join(fullPath, "..");

      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }

      writeFileSync(fullPath, content, "utf-8");

      const validation = await validateFileSyntax(fullPath);
      if (!validation.isValid) {
        return {
          outputText: `Error: File written but has syntax errors:
${validation.error}`,
          metadata: { exit_code: 1, path: filePath, syntax_error: true },
        };
      }

      return {
        outputText: `Successfully wrote ${content.length} chars to ${filePath}`,
        metadata: { exit_code: 0, path: filePath },
      };
    } catch (err) {
      return { outputText: `Error writing file: ${String(err)}`, metadata: { exit_code: 1 } };
    }
  }

  private async handleDeleteFile(rawArgs: string) {
    try {
      const args = JSON.parse(rawArgs);
      const filePath = args.path;

      if (!filePath) {
        return { outputText: "Error: 'path' is required", metadata: { exit_code: 1 } };
      }

      if (this.config.dryRun) {
        return {
          outputText: `[Dry Run] Would delete: ${filePath}`,
          metadata: { exit_code: 0, path: filePath, dry_run: true },
        };
      }

      const fullPath = join(process.cwd(), filePath);
      if (!existsSync(fullPath)) {
        return { outputText: `Error: File not found: ${filePath}`, metadata: { exit_code: 1 } };
      }

      const fs = await import("fs");
      fs.unlinkSync(fullPath);
      return {
        outputText: `Successfully deleted ${filePath}`,
        metadata: { exit_code: 0, path: filePath },
      };
    } catch (err) {
      return { outputText: `Error deleting file: ${String(err)}`, metadata: { exit_code: 1 } };
    }
  }

  private async handleListDirectory(rawArgs: string) {
    try {
      const args = JSON.parse(rawArgs);
      const dirPath = args.path || ".";
      const fullPath = join(process.cwd(), dirPath);

      if (!existsSync(fullPath)) {
        return { outputText: `Error: Directory not found: ${dirPath}`, metadata: { exit_code: 1 } };
      }

      const entries = readdirSync(fullPath, { withFileTypes: true })
        .sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        });

      const resultText = entries
        .map(e => `${e.isDirectory() ? "dir: " : "file:"} ${e.name}`)
        .join("\n") || "Directory is empty.";

      return {
        outputText: resultText,
        metadata: { exit_code: 0, path: dirPath, count: entries.length },
      };
    } catch (err) {
      return { outputText: `Error listing directory: ${String(err)}`, metadata: { exit_code: 1 } };
    }
  }

  private async handleSearchCodebase(rawArgs: string) {
    try {
      const args = JSON.parse(rawArgs);
      const pattern = args.pattern || args.query;
      const { path: searchPath, include } = args;

      if (!pattern) {
        return { outputText: "Error: 'pattern' is required", metadata: { exit_code: 1 } };
      }

      const rgArgs = ["rg", "--json", pattern];
      if (searchPath) rgArgs.push(searchPath);
      if (include) rgArgs.push("-g", include);

      const result = await handleExecCommand(
        { cmd: rgArgs, workdir: process.cwd(), timeoutInMillis: 30000 },
        this.config,
        this.approvalPolicy,
        this.getCommandConfirmation,
        this.execAbortController?.signal,
      );

      if (result.outputText === "aborted") return result;

      const lines = result.outputText.trim().split("\n");
      const matches: Array<any> = [];

      for (const line of lines) {
        if (!line) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "match") {
            matches.push({
              file: parsed.data.path.text,
              line: parsed.data.line_number,
              text: parsed.data.lines.text.trim(),
            });
          }
        } catch {
          // Skip invalid JSON
        }
      }

      return {
        outputText: matches.length > 0 ? JSON.stringify(matches, null, 2) : "No matches found.",
        metadata: { ...result.metadata, match_count: matches.length },
      };
    } catch (err) {
      return { outputText: `Error searching: ${String(err)}`, metadata: { exit_code: 1 } };
    }
  }

  private async handlePersistentMemory(rawArgs: string) {
    try {
      const args = JSON.parse(rawArgs);
      const { fact, category = "general" } = args;

      if (!fact) {
        return { outputText: "Error: 'fact' is required", metadata: { exit_code: 1 } };
      }

      if (this.config.dryRun) {
        return {
          outputText: `[Dry Run] Would save: [${category}] ${fact}`,
          metadata: { exit_code: 0, dry_run: true },
        };
      }

      const memoryDir = join(process.cwd(), ".codex");
      const memoryPath = join(memoryDir, "memory.md");

      if (!existsSync(memoryDir)) {
        mkdirSync(memoryDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().split("T")[0];
      const entry = `\n- [${timestamp}] [${category}] ${fact}`;
      appendFileSync(memoryPath, entry, "utf-8");

      return {
        outputText: `Fact saved to ${category}: ${fact}`,
        metadata: { exit_code: 0, path: memoryPath, category },
      };
    } catch (err) {
      return { outputText: `Error saving memory: ${String(err)}`, metadata: { exit_code: 1 } };
    }
  }

  private async handleSummarizeMemory() {
    try {
      const memoryPath = join(process.cwd(), ".codex", "memory.md");
      if (!existsSync(memoryPath)) {
        return { outputText: "No memory file found.", metadata: { exit_code: 0 } };
      }

      const content = readFileSync(memoryPath, "utf-8");
      return {
        outputText: `Memory Contents:\n${content}`,
        metadata: { exit_code: 0, length: content.length },
      };
    } catch (err) {
      return { outputText: `Error reading memory: ${String(err)}`, metadata: { exit_code: 1 } };
    }
  }

  private async handleReadFileLines(rawArgs: string) {
    try {
      const args = JSON.parse(rawArgs);
      const { path: filePath, start_line, end_line } = args;

      if (!filePath || start_line === undefined || end_line === undefined) {
        return {
          outputText: "Error: 'path', 'start_line', and 'end_line' are required",
          metadata: { exit_code: 1 },
        };
      }

      const fullPath = join(process.cwd(), filePath);
      if (!existsSync(fullPath)) {
        return { outputText: `Error: File not found: ${filePath}`, metadata: { exit_code: 1 } };
      }

      const content = readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");
      const start = Math.max(0, start_line - 1);
      const end = Math.min(lines.length, end_line);
      const resultText = lines.slice(start, end).join("\n");

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
      return { outputText: `Error reading lines: ${String(err)}`, metadata: { exit_code: 1 } };
    }
  }

  private async handleListFilesRecursive(rawArgs: string) {
    try {
      const args = JSON.parse(rawArgs);
      const startPath = args.path || ".";
      const depth = args.depth || 3;
      const fullPath = join(process.cwd(), startPath);

      if (!existsSync(fullPath)) {
        return { outputText: `Error: Path not found: ${startPath}`, metadata: { exit_code: 1 } };
      }

      const generateTree = async (dir: string, currentDepth: number): Promise<string> => {
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
              return `${indent}dir: ${entry.name}/\n${await generateTree(join(dir, entry.name), currentDepth + 1)}`;
            }
            return `${indent}file: ${entry.name}\n`;
          }),
        );

        return results.join("");
      };

      const tree = await generateTree(fullPath, 1);
      return {
        outputText: tree || "No files found.",
        metadata: { exit_code: 0, path: startPath, depth },
      };
    } catch (err) {
      return { outputText: `Error listing files: ${String(err)}`, metadata: { exit_code: 1 } };
    }
  }

  private isNetworkOrServerError(err: unknown): boolean {
    if (!err || typeof err !== "object") return false;
    const e = err as any;

    // OpenAI SDK connection error
    const ApiConnErrCtor = (OpenAI as any).APIConnectionError;
    if (ApiConnErrCtor && e instanceof ApiConnErrCtor) return true;

    // Node.js network errors
    if (typeof e.code === "string" && NETWORK_ERRNOS.has(e.code)) return true;
    if (e.cause && typeof e.cause === "object" && NETWORK_ERRNOS.has((e.cause as any).code ?? "")) {
      return true;
    }

    // HTTP 500+ errors
    if (typeof e.status === "number" && e.status >= 500) return true;

    // Network-related messages
    if (typeof e.message === "string" && /network|socket|stream/i.test(e.message)) {
      return true;
    }

    return false;
  }

  private async handleStreamError(err: unknown): Promise<boolean> {
    // Returns true if error was handled, false if should re-throw

    // Premature close
    if (
      err instanceof Error &&
      ((err as any).code === "ERR_STREAM_PREMATURE_CLOSE" ||
        err.message?.includes("Premature close"))
    ) {
      this.onItem({
        role: "assistant",
        content: [{ type: "text", text: "⚠️ Connection closed prematurely. Please try again." }],
      });
      this.onLoading(false);
      return true;
    }

    // Network/server errors
    if (this.isNetworkOrServerError(err)) {
      this.onItem({
        role: "assistant",
        content: [{ type: "text", text: "⚠️ Network error. Please check your connection and try again." }],
      });
      this.onLoading(false);
      return true;
    }

    // Invalid request
    const e = err as any;
    if (
      e?.type === "invalid_request_error" ||
      e?.cause?.type === "invalid_request_error"
    ) {
      const cause = e.cause || e;
      const reqId = cause.request_id || cause.requestId;
      const details = [
        `Status: ${cause.status || e.status || "unknown"}`,
        `Code: ${cause.code || e.code || "unknown"}`,
        `Type: ${cause.type || e.type || "unknown"}`,
        `Message: ${cause.message || e.message || "unknown"}`,
      ].join(", ");

      this.onItem({
        role: "assistant",
        content: [{
          type: "text",
          text: `⚠️ Request rejected${reqId ? ` (ID: ${reqId})` : ""}. ${details}`,
        }],
      });
      this.onLoading(false);
      return true;
    }

    return false;
  }

  public async run(
    input: Array<ChatCompletionMessageParam>,
    prevItems: Array<ChatCompletionMessageParam> = [],
  ): Promise<void> {
    try {
      if (this.terminated) throw new Error("AgentLoop terminated");

      const thisGeneration = ++this.generation;
      this.canceled = false;
      this.execAbortController = new AbortController();

      // Handle pending aborts from previous cancelled runs
      const abortOutputs: Array<ChatCompletionMessageParam> = [];
      for (const id of this.pendingAborts) {
        abortOutputs.push({
          role: "tool",
          tool_call_id: id,
          content: JSON.stringify({ output: "aborted", metadata: { exit_code: 1 } }),
        });
      }
      this.pendingAborts.clear();

      let turnInput = [...abortOutputs, ...input];
      this.onLoading(true);

      const staged: Array<ChatCompletionMessageParam> = [];
      const stageItem = (item: ChatCompletionMessageParam) => {
        if (thisGeneration !== this.generation) return;
        this.onItem(item);
        staged.push(item);
      };

      while (turnInput.length > 0) {
        if (this.canceled || this.hardAbort.signal.aborted) {
          this.onLoading(false);
          return;
        }

        for (const item of turnInput) {
          stageItem(item);
        }

        // Create stream with retries
        let stream: Stream<ChatCompletionChunk> | undefined;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            const reasoning: ReasoningEffort | undefined =
              this.model.startsWith("o") || this.model.startsWith("openai/o") ? "high" : undefined;

            const dryRunInfo = this.config.dryRun
              ? "\n\n--- DRY RUN ACTIVE ---\nChanges will NOT be persisted. Use this turn to plan and verify."
              : "";

            const basePrefix = this.instructions?.includes("You are operating as and within OpenCodex")
              ? ""
              : prefix;

            const mergedInstructions = [basePrefix, this.instructions, dryRunInfo]
              .filter(Boolean)
              .join("\n");

            if (isLoggingEnabled()) {
              log(`Instructions length: ${mergedInstructions.length}`);
            }

            stream = await this.oai.chat.completions.create({
              model: this.model,
              stream: true,
              messages: [
                { role: "system", content: mergedInstructions },
                ...prevItems,
                ...staged,
              ],
              reasoning_effort: reasoning,
              tools: TOOL_DEFINITIONS,
            });
            break;
          } catch (error: any) {
            const isTimeout = error instanceof APIConnectionTimeoutError;
            const status = error?.status ?? error?.httpStatus ?? error?.statusCode;
            const isRateLimit = status === 429 || error?.code === "rate_limit_exceeded";
            const isServerError = typeof status === "number" && status >= 500;

            if ((isTimeout || isRateLimit || isServerError) && attempt < MAX_RETRIES) {
              let delay = RATE_LIMIT_RETRY_WAIT_MS * 2 ** (attempt - 1);

              // Parse suggested retry time from message
              const msg = error?.message ?? "";
              const match = /(?:retry|try) again in ([\d.]+)s/i.exec(msg);
              if (match?.[1]) {
                const suggested = parseFloat(match[1]) * 1000;
                if (!Number.isNaN(suggested)) delay = suggested;
              }

              log(`Retry attempt ${attempt}/${MAX_RETRIES} after ${Math.round(delay)}ms...`);
              await new Promise((resolve) => setTimeout(resolve, delay));
              continue;
            }

            // Handle specific errors
            if (status === 429 && attempt >= MAX_RETRIES) {
              this.onItem({
                role: "assistant",
                content: [{ type: "text", text: "⚠️ Rate limit reached. Please try again later." }],
              });
              this.onLoading(false);
              return;
            }

            if (
              error?.code === "insufficient_quota" ||
              (error?.message || "").includes("quota")
            ) {
              this.onItem({
                role: "assistant",
                content: [{ type: "text", text: "⚠️ Insufficient quota. Please check billing." }],
              });
              this.onLoading(false);
              return;
            }

            if (status >= 400 && status < 500 && status !== 429) {
              this.onItem({
                role: "assistant",
                content: [{
                  type: "text",
                  text: `⚠️ Client error ${status}: ${error?.message || "Unknown error"}`,
                }],
              });
              this.onLoading(false);
              return;
            }

            throw error;
          }
        }

        if (!stream) {
          this.onLoading(false);
          return;
        }

        this.currentStream = stream;
        turnInput = [];

        try {
          let message: Extract<ChatCompletionMessageParam, { role: "assistant" }> | undefined;

          for await (const chunk of stream) {
            if (this.canceled) break;

            const delta = chunk?.choices?.[0]?.delta;
            const content = delta?.content;
            const reasoning = (delta as any)?.reasoning_content;
            const toolCall = delta?.tool_calls?.[0];

            // Update UI with partial results
            if (content || reasoning || this.currentActiveToolName) {
              let parsedArgs: Record<string, unknown> | undefined;
              if (this.currentActiveToolRawArguments) {
                try {
                  parsedArgs = JSON.parse(this.currentActiveToolRawArguments);
                } catch {
                  parsedArgs = { raw: this.currentActiveToolRawArguments };
                }
              }
              this.onPartialUpdate?.(content || "", reasoning, this.currentActiveToolName, parsedArgs);
            }

            // Build message
            if (!message) {
              message = delta as Extract<ChatCompletionChunk, { role: "assistant" }>;
            } else {
              if (content) {
                message.content = (message.content || "") + content;
              }
              if (!message.tool_calls && toolCall) {
                (message as any).tool_calls = [toolCall];
              } else if (toolCall && message.tool_calls) {
                if (toolCall.function?.name) {
                  message.tool_calls[0]!.function!.name += toolCall.function.name;
                }
                if (toolCall.function?.arguments) {
                  message.tool_calls[0]!.function!.arguments += toolCall.function.arguments;
                }
              }
            }

            if (toolCall?.id) {
              this.pendingAborts.add(toolCall.id);
            }

            const finishReason = chunk?.choices?.[0]?.finish_reason;
            if (finishReason && message && thisGeneration === this.generation && !this.canceled) {
              // Extract tool calls from content if needed (for non-native tool calling models)
              if (!message.tool_calls?.[0] && typeof message.content === "string") {
                const extracted = tryExtractToolCallsFromContent(message.content);
                if (extracted.length > 0) {
                  (message as any).tool_calls = extracted;
                  for (const call of extracted) {
                    if (call.id) this.pendingAborts.add(call.id);
                  }
                  message.content = "";
                }
              }

              if (message.tool_calls?.[0]) {
                message.tool_calls = flattenToolCalls(message.tool_calls);
                stageItem(message);
                const results = await this.handleFunctionCall(message);
                turnInput.push(...results);
              } else if (Object.keys(message).length > 0) {
                stageItem(message);
              }
            }
          }
        } catch (err) {
          if (await this.handleStreamError(err)) {
            return;
          }
          throw err;
        } finally {
          this.currentStream = null;
        }
      }

      // Clear pending aborts on successful completion
      this.pendingAborts.clear();
      this.onLoading(false);

    } catch (err) {
      // Final error handler
      if (await this.handleStreamError(err)) {
        return;
      }
      throw err;
    }
  }
}

const prefix = `You are OpenCodex, a terminal-based agentic coding assistant. You wrap LLM models to enable natural language interaction with local codebases. Be precise, safe, and thorough.

## Capabilities
- Read/write/delete files and list directories
- Apply surgical patches and execute shell commands
- Stream responses and emit function calls
- Operate in a sandboxed, git-backed workspace
- Manage user approvals based on policy

## Context
OpenCodex refers to the open-source agentic CLI (not OpenAI's legacy Codex model). You have full access to the local codebase.

## Core Protocol
**Persist until complete.** Keep working until the user's query is fully resolved. Only terminate when you are certain the problem is solved.

**Never simulate tool output.** Do not type JSON/XML observation blocks. Call tools and let the system provide actual responses.

**Gather facts.** If unsure about file contents or structure, use tools to read files. Do not guess.

## Safety & Efficiency
- **Parallelism:** Emit multiple tool calls per turn (one per line) for faster information gathering
- **Loop Protection:** If a command fails twice with the same error, stop immediately. Explain the issue and ask for help rather than retrying blindly
- **Large Files:** Use \`read_file_lines\` for files >500 lines to manage context window
- **Dry Run Mode:** When active, changes are not persisted. Explain your planned approach thoroughly

## Execution Standards
When writing or modifying files:
- **Verify:** Write/run unit tests. Execute existing test suites to prevent regressions
- **Quality:** Clean, idiomatic code. Follow SOLID, DRY principles. Match existing style exactly
- **Security:** Validate inputs, avoid dangerous functions, never hardcode secrets
- **Root Cause:** Fix problems at the source, not surface-level patches
- **Minimalism:** Focus strictly on the task. No unnecessary complexity
- **Documentation:** Update docstrings as needed. Use inline comments only for complex "why" logic
- **Git:** Use \`git log\`/\`git blame\` for context. Commits are handled automatically
- **Compliance:** Run \`pre-commit run --files ...\` if config exists (ignore unrelated lint errors)
- **Final Review:** Run \`git status\` and \`git diff\` before finishing. No scratch files or accidental changes

When not modifying files:
- Respond as a knowledgeable, capable remote teammate
- Do not tell users to "save files" you already wrote via \`apply_patch\`
- Do not show large file contents unless explicitly requested

Working on proprietary repos and analyzing vulnerabilities is permitted.`;
