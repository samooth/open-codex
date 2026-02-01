import type { ChatCompletionMessageParam } from "openai/resources/chat/completions/completions.mjs";
import { parseToolCallArguments } from "../parsers.js";
import { log, isLoggingEnabled } from "./log.js";
import { handleExecCommand } from "./handle-exec-command.js";
import { validateFileSyntax } from "./validate-file.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from "fs";
import { join } from "path";
import { 
  handleReadFile,
  handleWriteFile,
  handleDeleteFile,
  handleListDirectory,
  handleSearchCodebase,
  handlePersistentMemory,
  handleSummarizeMemory,
  handleReadFileLines,
  handleListFilesRecursive,
  handleWebSearch,
  handleFetchUrl,
  handleSemanticSearch
} from "./tool-handlers.js";
import { 
  checkLoopDetection,
  createLoopErrorResponse,
  updateToolCallHistory
} from "./loop-protection.js";

import type { AgentContext } from "./types.js";

/**
 * Handles function calls from the LLM and routes them to appropriate handlers
 * This replaces the large handleFunctionCall method in the original agent-loop.ts
 */
export async function handleFunctionCall(
  itemArg: ChatCompletionMessageParam,
  ctx: AgentContext,
  currentActiveToolName: string | undefined,
  currentActiveToolRawArguments: string | undefined,
  toolCallHistory: Map<string, { count: number; lastError?: string }>,
  onItem: (item: ChatCompletionMessageParam) => void,
  sessionId: string,
  onPartialUpdate?: (content: string, reasoning?: string, activeToolName?: string, activeToolArguments?: Record<string, any>) => void,
  onLoading: (loading: boolean) => void,
  canceled: boolean,
  hardAbortSignal: any
): Promise<Array<ChatCompletionMessageParam>> {
  if (canceled) {
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

      // Map repo_browser aliases to standard names
      if (name === "repo_browser.exec" || name === "repo_browser.exec<|channel|>commentary") {name = "shell";}
      if (name === "repo_browser.read_file" || name === "repo_browser.open_file" || name === "repo_browser.cat" || name === "repo_browser.read_file<|channel|>commentary" || name === "repo_browser.open_file<|channel|>commentary") {name = "read_file";}
      if (name === "repo_browser.write_file" || name === "repo_browser.write_file<|channel|>commentary") {name = "write_file";}
      if (name === "repo_browser.read_file_lines" || name === "repo_browser.read_file_lines<|channel|>commentary") {name = "read_file_lines";}
      if (name === "repo_browser.list_files" || name === "repo_browser.list_files<|channel|>commentary") {name = "list_files_recursive";}
      if (name === "repo_browser.print_tree" || name === "repo_browser.print_tree<|channel|>commentary") {name = "list_files_recursive";}
      if (name === "repo_browser.list_directory" || name === "repo_browser.ls" || name === "repo_browser.list_directory<|channel|>commentary" || name === "repo_browser.ls<|channel|>commentary") {name = "list_directory";}
      if (name === "repo_browser.search" || name === "repo_browser.search<|channel|>commentary") {name = "search_codebase";}
      if (name === "repo_browser.rm" || name === "repo_browser.rm<|channel|>commentary") {name = "delete_file";}
    }

    const rawArguments: string | undefined = isChatStyle
      ? (toolCall as any).function?.arguments
      : (toolCall as any).arguments;

    const callId: string = (toolCall as any).id || (toolCall as any).call_id;

    const toolCallKey = `${name}:${rawArguments}`;
    const history = toolCallHistory.get(toolCallKey) || { count: 0 };

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
        createLoopErrorResponse(toolCallKey, toolCallHistory, callId)
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
        ctx.config,
        ctx.approvalPolicy,
        ctx.getCommandConfirmation,
        ctx.execAbortController?.signal,
        (chunk) => {
          // Emit a "thinking" update with partial output
          onItem({
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
      if (name === "apply_patch" && metadata["exit_code"] === 0 && (args as any).patch) {
        const { identify_files_needed, identify_files_added } = await import("./apply-patch.js");
        const affectedFiles = [
          ...identify_files_needed((args as any).patch),
          ...identify_files_added((args as any).patch)
        ];
        
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
    } else if (name === "search_codebase") {
      const result = await handleSearchCodebase(ctx, rawArguments ?? "{}");
      outputText = result.outputText;
      metadata = result.metadata;
      additionalItems = result.additionalItems;
    } else if (name === "persistent_memory") {
      const result = await handlePersistentMemory(ctx, rawArguments ?? "{}");
      outputText = result.outputText;
      metadata = result.metadata;
      additionalItems = result.additionalItems;
    } else if (name === "summarize_memory") {
      const result = await handleSummarizeMemory();
      outputText = result.outputText;
      metadata = result.metadata;
    } else if (name === "read_file_lines") {
      const result = await handleReadFileLines(ctx, rawArguments ?? "{}");
      outputText = result.outputText;
      metadata = result.metadata;
      additionalItems = result.additionalItems;
    } else if (name === "list_files_recursive") {
      const result = await handleListFilesRecursive(ctx, rawArguments ?? "{}");
      outputText = result.outputText;
      metadata = result.metadata;
      additionalItems = result.additionalItems;
    } else if (name === "read_file") {
      const result = await handleReadFile(ctx, rawArguments ?? "{}");
      outputText = result.outputText;
      metadata = result.metadata;
      additionalItems = result.additionalItems;
    } else if (name === "write_file") {
      const result = await handleWriteFile(ctx, rawArguments ?? "{}");
      outputText = result.outputText;
      metadata = result.metadata;
      additionalItems = result.additionalItems;
    } else if (name === "delete_file") {
      const result = await handleDeleteFile(ctx, rawArguments ?? "{}");
      outputText = result.outputText;
      metadata = result.metadata;
      additionalItems = result.additionalItems;
    } else if (name === "list_directory") {
      const result = await handleListDirectory(ctx, rawArguments ?? "{}");
      outputText = result.outputText;
      metadata = result.metadata;
      additionalItems = result.additionalItems;
    } else if (name === "web_search") {
      const result = await handleWebSearch(ctx, rawArguments ?? "{}");
      outputText = result.outputText;
      metadata = result.metadata;
    } else if (name === "fetch_url") {
      const result = await handleFetchUrl(ctx, rawArguments ?? "{}");
      outputText = result.outputText;
      metadata = result.metadata;
    } else if (name === "semantic_search") {
      const result = await handleSemanticSearch(ctx, rawArguments ?? "{}");
      outputText = result.outputText;
      metadata = result.metadata;
    } else {
      return [outputItem];
    }

    outputItem.content = JSON.stringify({ output: outputText, metadata });

    // Update history for loop detection
    updateToolCallHistory(toolCallKey, toolCallHistory, metadata);

    const callResults: Array<ChatCompletionMessageParam> = [outputItem];
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