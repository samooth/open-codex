import type { AgentContext } from "./types.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";

import { parseToolCallArguments } from "../parsers.js";
import { handleExecCommand } from "./handle-exec-command.js";
import { log, isLoggingEnabled } from "./log.js";
import { prefix } from "./system-prompt.js";
import { TOOL_APPLY_PATCH, TOOL_SHELL } from "./tool-constants.js";
import { tools } from "./tool-definitions.js";
import * as handlers from "./tool-handlers.js";
import { validateFileSyntax } from "./validate-file.js";
import { appendFileSync } from "fs";

export async function handleFunctionCall(
  ctx: AgentContext,
  itemArg: ChatCompletionMessageParam,
  toolCallHistory: Map<string, { count: number; lastError?: string }>,
  _onLoading: (loading: boolean) => void,
  onPartialUpdate?: (content: string, reasoning?: string, activeToolName?: string, activeToolArguments?: Record<string, any>) => void,
  isFocused?: boolean,
): Promise<Array<ChatCompletionMessageParam>> {
  if (ctx.execAbortController?.signal.aborted) {
    return [];
  }

  if (itemArg.role !== "assistant" || !itemArg.tool_calls) {
    return [];
  }

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

      if (name && (ctx.config.provider === "google" || ctx.config.provider === "gemini")) {
        // We might need to pass the sanitize function or import it
        // For now let's assume names are handled in the loop or we can import it
        const { sanitizeGoogleToolName } = await import("./google-utils.js");
        name = sanitizeGoogleToolName(name);
      }

      // Map repo_browser aliases to standard names
      if (name === "repo_browser.exec" || name === "repo_browser.exec<|channel|>commentary" || name === "repo_browser.exec__channel__commentary") { name = TOOL_SHELL; }
      if (name === "repo_browser.read_file" || name === "repo_browser.open_file" || name === "repo_browser.cat" || name === "repo_browser.read_file<|channel|>commentary" || name === "repo_browser.read_file__channel__commentary" || name === "repo_browser.open_file<|channel|>commentary" || name === "repo_browser.open_file__channel__commentary") { name = "read_file"; }
      if (name === "repo_browser.write_file" || name === "repo_browser.write_file<|channel|>commentary" || name === "repo_browser.write_file__channel__commentary") { name = "write_file"; }
      if (name === "repo_browser.read_file_lines" || name === "repo_browser.read_file_lines<|channel|>commentary" || name === "repo_browser.read_file_lines__channel__commentary") { name = "read_file_lines"; }
      if (name === "repo_browser.list_files" || name === "repo_browser.list_files<|channel|>commentary" || name === "repo_browser.list_files__channel__commentary") { name = "list_files_recursive"; }
      if (name === "repo_browser.print_tree" || name === "repo_browser.print_tree<|channel|>commentary" || name === "repo_browser.print_tree__channel__commentary") { name = "list_files_recursive"; }
      if (name === "repo_browser.list_directory" || name === "repo_browser.ls" || name === "repo_browser.list_directory<|channel|>commentary" || name === "repo_browser.list_directory__channel__commentary" || name === "repo_browser.ls<|channel|>commentary" || name === "repo_browser.ls__channel__commentary") { name = "list_directory"; }
      if (name === "repo_browser.search" || name === "repo_browser.search<|channel|>commentary" || name === "repo_browser.search__channel__commentary") { name = "search_codebase"; }
      if (name === "repo_browser.rm" || name === "repo_browser.rm<|channel|>commentary" || name === "repo_browser.rm__channel__commentary") { name = "delete_file"; }
      if (name === "repo_browser.edit_file") { name = "edit_file"; }
      if (name === "repo_browser.read_symbols") { name = "read_symbols"; }
      if (name === "repo_browser.search_symbols") { name = "search_symbols"; }
      if (name === "repo_browser.run_diagnostics") { name = "run_diagnostics"; }
      if (name === "repo_browser.update_tasks") { name = "update_tasks"; }
      if (name === "repo_browser.checkpoint") { name = "checkpoint"; }
      if (name === "repo_browser.web_search") { name = "web_search"; }
      if (name === "repo_browser.fetch_url") { name = "fetch_url"; }
      if (name === "repo_browser.browse" || name === "google_search") { name = "browse"; }
    }

    const rawArguments: string | undefined = isChatStyle
      ? (toolCall as any).function?.arguments
      : (toolCall as any).arguments;

    const callId: string = (toolCall as any).id || (toolCall as any).call_id;
    const thought_signature: string | undefined = (toolCall as any).thought_signature;

    const toolCallKey = `${name}:${rawArguments}`;
    const history = toolCallHistory.get(toolCallKey) || { count: 0 };

    if (process.env["DEBUG"] === "1") {
      log(`[DEBUG] Tool Call: ${name}`);
      log(`[DEBUG] Arguments: ${rawArguments}`);
    }

    const result = parseToolCallArguments(rawArguments ?? "{}");
    if (isLoggingEnabled()) {
      log(
        `handleFunctionCall(): name=${name ?? "undefined"} callId=${callId} args=${rawArguments} count=${history.count}`,
      );
    }

    if (history.count >= 2) {
      return {
        toolOutput: {
          role: "tool",
          tool_call_id: callId,
          content: JSON.stringify({
            output: `Error: Loop detected. This exact tool call has been attempted ${history.count} times already and failed with: "${history.lastError}". Please stop and ask the user for clarification instead of retrying again.`,
            metadata: { exit_code: 1, duration_seconds: 0, loop_detected: true },
          }),
        } as ChatCompletionMessageParam,
      };
    }

    if (!result.success) {
      try {
        const provider = ctx.config.provider || "unknown";
        appendFileSync("opencodex.error.log", `[${new Date().toISOString()}] Provider: ${provider}, Model: ${ctx.model}\nTool Argument Parsing Failed: ${name}\nArguments: ${rawArguments}\nError: ${result.error}\n\n`);
      } catch { /* ignore logging errors */ }
      return {
        toolOutput: {
          role: "tool",
          tool_call_id: callId,
          content: JSON.stringify({
            output: result.error,
            metadata: { exit_code: 1, duration_seconds: 0 },
          }),
        } as ChatCompletionMessageParam,
      };
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

    if (
      (name === "container.exec" ||
        name === TOOL_SHELL ||
        name === TOOL_APPLY_PATCH) &&
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
          ctx.onItem({
            role: "tool",
            tool_call_id: callId,
            content: JSON.stringify({
              output: chunk,
              metadata: { exit_code: undefined, duration_seconds: 0 },
              streaming: true,
            }),
          });
        },
        isFocused,
      );
      outputText = result.outputText;
      metadata = result.metadata;
      additionalItems = result.additionalItems;

      // --- AUTO-CORRECTION LOOP for apply_patch ---
      if (name === TOOL_APPLY_PATCH && (args as any).patch) {
        const { identify_files_needed, identify_files_added } = await import("./apply-patch.js");
        const affectedFiles = [
          ...identify_files_needed((args as any).patch),
          ...identify_files_added((args as any).patch)
        ];
        
        for (const file of affectedFiles) {
          ctx.onFileAccess?.(file);
        }

        if (metadata["exit_code"] === 0) {
          for (const file of affectedFiles) {
            const validation = await validateFileSyntax(file, { enableDeepLinter: ctx.config.enableDeepLinter });
            if (!validation.isValid) {
              outputText = `Error: The patch was applied but file "${file}" now contains issues:\n${validation.error}\nPlease fix these issues and apply a new patch.`;
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
    } else if (name === "edit_file") {
      const result = await handlers.handleEditFile(ctx, rawArguments ?? "{}");
      outputText = result.outputText;
      metadata = result.metadata;
      additionalItems = result.additionalItems;
    } else if (name === "read_symbols") {
      const result = await handlers.handleReadSymbols(ctx, rawArguments ?? "{}");
      outputText = result.outputText;
      metadata = result.metadata;
    } else if (name === "search_symbols") {
      const result = await handlers.handleSearchSymbols(ctx, rawArguments ?? "{}");
      outputText = result.outputText;
      metadata = result.metadata;
    } else if (name === "run_diagnostics") {
      const result = await handlers.handleRunDiagnostics(ctx);
      outputText = result.outputText;
      metadata = result.metadata;
    } else if (name === "update_tasks") {
      const result = await handlers.handleUpdateTasks(ctx, rawArguments ?? "{}");
      outputText = result.outputText;
      metadata = result.metadata;
    } else if (name === "checkpoint") {
      const result = await handlers.handleCheckpoint(ctx, rawArguments ?? "{}");
      outputText = result.outputText;
      metadata = result.metadata;
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
    } else if (name === "browse") {
      const result = await handlers.handleBrowse(ctx, rawArguments ?? "{}");
      outputText = result.outputText;
      metadata = result.metadata;
    } else if (name === "semantic_search") {
      const result = await handlers.handleSemanticSearch(ctx, rawArguments ?? "{}");
      outputText = result.outputText;
      metadata = result.metadata;
    } else if (name === "npm_search") {
      const result = await handlers.handleNpmSearch(ctx, rawArguments ?? "{}");
      outputText = result.outputText;
      metadata = result.metadata;
    } else if (name === "snyk_search") {
      const result = await handlers.handleSnykSearch(ctx, rawArguments ?? "{}");
      outputText = result.outputText;
      metadata = result.metadata;
    } else if (name === "ask_confirmation") {
      const result = await handlers.handleAskConfirmation(ctx, rawArguments ?? "{}");
      outputText = result.outputText;
      metadata = result.metadata;
    } else if (name === "ask_multiple_choice") {
      const result = await handlers.handleAskMultipleChoice(ctx, rawArguments ?? "{}");
      outputText = result.outputText;
      metadata = result.metadata;
    } else if (name === "index_codebase") {
      if (process.env["DEBUG"] === "1") {
        log(`Tool call: index_codebase invoked`);
      }
      const existing = ctx.agent.hasIndex();
      ctx.onItem({
        role: "assistant",
        content: existing 
          ? "Refreshing existing index... reusing cached embeddings for unchanged files."
          : "Indexing codebase... this might take a while depending on the size.",
      });
      let totalIndexed = 0;
      await ctx.agent.indexCodebase((curr: number, total: number, file: string) => {
        totalIndexed = total;
        const progressMsg = `Indexing progress: ${curr}/${total} - ${file}`;
        if (curr % 10 === 0) {
          log(progressMsg);
        }
        // Update UI with current progress
        onPartialUpdate?.("", progressMsg, "index_codebase", { current: curr, total, file });
      });
      // Clear progress from thinking indicator
      onPartialUpdate?.("", "", undefined, undefined);
      outputText = `Codebase indexing complete. Indexed ${totalIndexed} files.`;
      metadata = { exit_code: 0, count: totalIndexed };
    } else if (name === "show_context") {
      const { tool_name } = args;
      if (tool_name) {
        const tool = tools.find((t) => (t as any).function.name === tool_name);
        if (tool) {
          outputText = `CONTEXT FOR TOOL: ${tool_name}\n\nDescription: ${
            (tool as any).function.description
          }\n\nParameters: ${JSON.stringify(
            (tool as any).function.parameters,
            null,
            2,
          )}`;
        } else {
          outputText = `Error: Tool '${tool_name}' not found.`;
        }
      } else {
        const availableTools = tools
          .map((t) => `- ${(t as any).function.name}`)
          .join("\n");
        outputText = `AGENT CONTEXT:\n\nCORE PROTOCOL:\n${prefix}\n\nAVAILABLE TOOLS:\n${availableTools}\n\nTo get help for a specific tool, call show_context({tool_name: 'tool_name'}).`;
      }
      metadata = { exit_code: 0 };
    } else {
      return { toolOutput: outputItem };
    }

    outputItem.content = JSON.stringify({ output: outputText, metadata });
    if (thought_signature) {
      (outputItem as any).thought_signature = thought_signature;
    }

    // Update history for loop detection
    if (metadata["exit_code"] !== 0) {
      try {
        const provider = ctx.config.provider || "unknown";
        appendFileSync("opencodex.error.log", `[${new Date().toISOString()}] Provider: ${provider}, Model: ${ctx.model}\nTool Execution Failed: ${name}\nArguments: ${rawArguments}\nExit Code: ${metadata["exit_code"]}\nOutput: ${outputText}\n\n`);
      } catch { /* ignore logging errors */ }
      
      toolCallHistory.set(toolCallKey, {
        count: history.count + 1,
        lastError: outputText.slice(0, 200), // Store a snippet of the error
      });
    } else {
      // If it succeeded, we can clear it from history or at least reset count
      toolCallHistory.delete(toolCallKey);
    }

    if (additionalItems && thought_signature) {
      for (const item of additionalItems) {
        (item as any).thought_signature = thought_signature;
      }
    }

    return { toolOutput: outputItem, additionalItems };
  });

  const allCallResults = await Promise.all(toolCallPromises);
  const results: Array<ChatCompletionMessageParam> = [];
  const seenAdditionalItems = new Set<string>();
  const abortedMessages = new Set<string>();

  for (const res of allCallResults) {
    results.push(res.toolOutput);
    
    // Check if the tool output metadata indicates an abortion
    try {
      const content = JSON.parse(res.toolOutput.content as string);
      if (content.metadata?.aborted && content.metadata?.note) {
        abortedMessages.add(content.metadata.note);
      }
    } catch { /* ignore */ }
  }

  // First, add any unique aborted messages
  for (const note of abortedMessages) {
    const item: ChatCompletionMessageParam = {
      role: "user",
      content: [{ type: "text", text: note }],
    };
    const key = JSON.stringify(item);
    results.push(item);
    seenAdditionalItems.add(key);
  }

  // Then, add any other unique additionalItems
  for (const res of allCallResults) {
    if (res.additionalItems) {
      for (const item of res.additionalItems) {
        const key = JSON.stringify(item);
        if (!seenAdditionalItems.has(key)) {
          results.push(item);
          seenAdditionalItems.add(key);
        }
      }
    }
  }

  return results;
}
