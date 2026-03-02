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
  onPartialUpdate?: (
    content: string,
    reasoning?: string,
    activeToolName?: string,
    activeToolArguments?: Record<string, any>,
  ) => void,
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

      if (
        name &&
        (ctx.config.provider === "google" || ctx.config.provider === "gemini")
      ) {
        // We might need to pass the sanitize function or import it
        // For now let's assume names are handled in the loop or we can import it
        const { sanitizeGoogleToolName } = await import("./google-utils.js");
        name = sanitizeGoogleToolName(name);
      }

      // Map repo_browser aliases to standard names
      if (
        name === "repo_browser_exec" ||
        name === "repo_browser_exec__channel__commentary" ||
        name === "repo_browser_exec__channel__commentary"
      ) {
        name = TOOL_SHELL;
      }
      if (
        name === "repo_browser_read_file" ||
        name === "repo_browser_open_file" ||
        name === "repo_browser_cat" ||
        name === "repo_browser_read_file__channel__commentary" ||
        name === "repo_browser_read_file__channel__commentary" ||
        name === "repo_browser_open_file__channel__commentary" ||
        name === "repo_browser_open_file__channel__commentary"
      ) {
        name = "read_file";
      }
      if (
        name === "repo_browser_write_file" ||
        name === "repo_browser_write_file__channel__commentary" ||
        name === "repo_browser_write_file__channel__commentary"
      ) {
        name = "write_file";
      }
      if (
        name === "repo_browser_read_file_lines" ||
        name === "repo_browser_read_file_lines__channel__commentary" ||
        name === "repo_browser_read_file_lines__channel__commentary"
      ) {
        name = "read_file_lines";
      }
      if (
        name === "repo_browser_list_files" ||
        name === "repo_browser_list_files__channel__commentary" ||
        name === "repo_browser_list_files__channel__commentary"
      ) {
        name = "list_files_recursive";
      }
      if (
        name === "repo_browser_print_tree" ||
        name === "repo_browser_print_tree__channel__commentary" ||
        name === "repo_browser_print_tree__channel__commentary"
      ) {
        name = "list_files_recursive";
      }
      if (
        name === "repo_browser_list_directory" ||
        name === "repo_browser_ls" ||
        name === "repo_browser_list_directory__channel__commentary" ||
        name === "repo_browser_list_directory__channel__commentary" ||
        name === "repo_browser_ls__channel__commentary" ||
        name === "repo_browser_ls__channel__commentary"
      ) {
        name = "list_directory";
      }
      if (
        name === "repo_browser_search" ||
        name === "repo_browser_search__channel__commentary" ||
        name === "repo_browser_search__channel__commentary"
      ) {
        name = "search_codebase";
      }
      if (
        name === "repo_browser_rm" ||
        name === "repo_browser_rm__channel__commentary" ||
        name === "repo_browser_rm__channel__commentary"
      ) {
        name = "delete_file";
      }
      if (name === "repo_browser_edit_file") {
        name = "edit_file";
      }
      if (name === "repo_browser_read_symbols") {
        name = "read_symbols";
      }
      if (name === "repo_browser_search_symbols") {
        name = "search_symbols";
      }
      if (name === "repo_browser_run_diagnostics") {
        name = "run_diagnostics";
      }
      if (name === "repo_browser_update_tasks") {
        name = "update_tasks";
      }
      if (name === "repo_browser_checkpoint") {
        name = "checkpoint";
      }
      if (name === "repo_browser_web_search") {
        name = "web_search";
      }
      if (name === "repo_browser_fetch_url") {
        name = "fetch_url";
      }
      if (name === "repo_browser_browse" || name === "google_search") {
        name = "browse";
      }
    }

    const rawArguments: string | undefined = isChatStyle
      ? (toolCall as any).function?.arguments
      : (toolCall as any).arguments;

    const callId: string = (toolCall as any).id || (toolCall as any).call_id;
    const thought_signature: string | undefined = (toolCall as any)
      .thought_signature;

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

    // Refined Loop Protection: Only hard-stop if the error is identical
    if (history.count >= 2 && history.lastError) {
      return {
        toolOutput: {
          role: "tool",
          tool_call_id: callId,
          content: JSON.stringify({
            output: `Error: Loop detected. This exact tool call has been attempted ${history.count} times already and failed with the same error: "${history.lastError}". Please stop and ask the user for clarification instead of retrying again.`,
            metadata: {
              exit_code: 1,
              duration_seconds: 0,
              loop_detected: true,
            },
          }),
        } as ChatCompletionMessageParam,
      };
    }

    if (!result.success) {
      try {
        const provider = ctx.config.provider || "unknown";
        appendFileSync(
          "opencodex.error.log",
          `[${new Date().toISOString()}] Provider: ${provider}, Model: ${ctx.model}\nTool Argument Parsing Failed: ${name}\nArguments: ${rawArguments}\nError: ${result.error}\n\n`,
        );
      } catch {
        /* ignore logging errors */
      }
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

    let outputText = "";
    let metadata: Record<string, any> = { exit_code: 1 };
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
        const { identify_files_needed, identify_files_added } = await import(
          "./apply-patch.js"
        );
        const affectedFiles = [
          ...identify_files_needed((args as any).patch),
          ...identify_files_added((args as any).patch),
        ];

        for (const file of affectedFiles) {
          ctx.onFileAccess?.(file);
        }

        if (metadata["exit_code"] === 0) {
          for (const file of affectedFiles) {
            const validation = await validateFileSyntax(file, {
              enableDeepLinter: ctx.config.enableDeepLinter,
            });
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
      let result = await handlers.handleSearchCodebase(
        ctx,
        rawArguments ?? "{}",
      );
      if (!result) {
        result = {
          outputText: "Error: Tool call failed to return a result.",
          metadata: { exit_code: 1 },
          additionalItems: [],
        };
      }
      outputText = result.outputText;
      metadata = result.metadata;
      additionalItems = result.additionalItems;
    } else if (name === "persistent_memory") {
      let result = await handlers.handlePersistentMemory(
        ctx,
        rawArguments ?? "{}",
      );
      if (!result) {
        result = {
          outputText: "Error: Tool call failed to return a result.",
          metadata: { exit_code: 1 },
          additionalItems: [],
        };
      }
      outputText = result.outputText;
      metadata = result.metadata;
      additionalItems = result.additionalItems;
    } else if (name === "summarize_memory") {
      let result = await handlers.handleSummarizeMemory();
      if (!result) {
        result = {
          outputText: "Error: Tool call failed to return a result.",
          metadata: { exit_code: 1 },
        };
      }
      outputText = result.outputText;
      metadata = result.metadata;
    } else if (name === "query_memory") {
      let result = await handlers.handleQueryMemory(rawArguments ?? "{}");
      if (!result) {
        result = {
          outputText: "Error: Tool call failed to return a result.",
          metadata: { exit_code: 1 },
        };
      }
      outputText = result.outputText;
      metadata = result.metadata;
    } else if (name === "forget_memory") {
      let result = await handlers.handleForgetMemory(rawArguments ?? "{}");
      if (!result) {
        result = {
          outputText: "Error: Tool call failed to return a result.",
          metadata: { exit_code: 1 },
        };
      }
      outputText = result.outputText;
      metadata = result.metadata;
    } else if (name === "maintain_memory") {
      let result = await handlers.handleMaintainMemory(ctx);
      if (!result) {
        result = {
          outputText: "Error: Tool call failed to return a result.",
          metadata: { exit_code: 1 },
        };
      }
      outputText = result.outputText;
      metadata = result.metadata;
    } else if (name === "read_file_lines") {
      let result = await handlers.handleReadFileLines(
        ctx,
        rawArguments ?? "{}",
      );
      if (!result) {
        result = {
          outputText: "Error: Tool call failed to return a result.",
          metadata: { exit_code: 1 },
          additionalItems: [],
        };
      }
      outputText = result.outputText;
      metadata = result.metadata;
      additionalItems = result.additionalItems;
    } else if (name === "list_files_recursive") {
      let result = await handlers.handleListFilesRecursive(
        ctx,
        rawArguments ?? "{}",
      );
      if (!result) {
        result = {
          outputText: "Error: Tool call failed to return a result.",
          metadata: { exit_code: 1 },
          additionalItems: [],
        };
      }
      outputText = result.outputText;
      metadata = result.metadata;
      additionalItems = result.additionalItems;
    } else if (name === "read_file") {
      let result = await handlers.handleReadFile(ctx, rawArguments ?? "{}");
      if (!result) {
        result = {
          outputText: "Error: Tool call failed to return a result.",
          metadata: { exit_code: 1 },
          additionalItems: [],
        };
      }
      outputText = result.outputText;
      metadata = result.metadata;
      additionalItems = result.additionalItems;
    } else if (name === "write_file") {
      let result = await handlers.handleWriteFile(ctx, rawArguments ?? "{}");
      if (!result) {
        result = {
          outputText: "Error: Tool call failed to return a result.",
          metadata: { exit_code: 1 },
          additionalItems: [],
        };
      }
      outputText = result.outputText;
      metadata = result.metadata;
      additionalItems = result.additionalItems;
    } else if (name === "edit_file") {
      let result = await handlers.handleEditFile(ctx, rawArguments ?? "{}");
      if (!result) {
        result = {
          outputText: "Error: Tool call failed to return a result.",
          metadata: { exit_code: 1 },
          additionalItems: [],
        };
      }
      outputText = result.outputText;
      metadata = result.metadata;
      additionalItems = result.additionalItems;
    } else if (name === "read_symbols") {
      let result = await handlers.handleReadSymbols(ctx, rawArguments ?? "{}");
      if (!result) {
        result = {
          outputText: "Error: Tool call failed to return a result.",
          metadata: { exit_code: 1 },
        };
      }
      outputText = result.outputText;
      metadata = result.metadata;
    } else if (name === "search_symbols") {
      let result = await handlers.handleSearchSymbols(
        ctx,
        rawArguments ?? "{}",
      );
      if (!result) {
        result = {
          outputText: "Error: Tool call failed to return a result.",
          metadata: { exit_code: 1 },
        };
      }
      outputText = result.outputText;
      metadata = result.metadata;
    } else if (name === "run_diagnostics") {
      let result = await handlers.handleRunDiagnostics(ctx);
      if (!result) {
        result = {
          outputText: "Error: Tool call failed to return a result.",
          metadata: { exit_code: 1 },
        };
      }
      outputText = result.outputText;
      metadata = result.metadata;
    } else if (name === "update_tasks") {
      let result = await handlers.handleUpdateTasks(ctx, rawArguments ?? "{}");
      if (!result) {
        result = {
          outputText: "Error: Tool call failed to return a result.",
          metadata: { exit_code: 1 },
        };
      }
      outputText = result.outputText;
      metadata = result.metadata;
    } else if (name === "checkpoint") {
      let result = await handlers.handleCheckpoint(ctx, rawArguments ?? "{}");
      if (!result) {
        result = {
          outputText: "Error: Tool call failed to return a result.",
          metadata: { exit_code: 1 },
        };
      }
      outputText = result.outputText;
      metadata = result.metadata;
    } else if (name === "delete_file") {
      let result = await handlers.handleDeleteFile(ctx, rawArguments ?? "{}");
      if (!result) {
        result = {
          outputText: "Error: Tool call failed to return a result.",
          metadata: { exit_code: 1 },
          additionalItems: [],
        };
      }
      outputText = result.outputText;
      metadata = result.metadata;
      additionalItems = result.additionalItems;
    } else if (name === "list_directory") {
      let result = await handlers.handleListDirectory(
        ctx,
        rawArguments ?? "{}",
      );
      if (!result) {
        result = {
          outputText: "Error: Tool call failed to return a result.",
          metadata: { exit_code: 1 },
          additionalItems: [],
        };
      }
      outputText = result.outputText;
      metadata = result.metadata;
      additionalItems = result.additionalItems;
    } else if (name === "web_search") {
      let result = await handlers.handleWebSearch(ctx, rawArguments ?? "{}");
      if (!result) {
        result = {
          outputText: "Error: Tool call failed to return a result.",
          metadata: { exit_code: 1 },
        };
      }
      outputText = result.outputText;
      metadata = result.metadata;
    } else if (name === "fetch_url") {
      let result = await handlers.handleFetchUrl(ctx, rawArguments ?? "{}");
      if (!result) {
        result = {
          outputText: "Error: Tool call failed to return a result.",
          metadata: { exit_code: 1 },
        };
      }
      outputText = result.outputText;
      metadata = result.metadata;
    } else if (name === "browse") {
      let result = await handlers.handleBrowse(ctx, rawArguments ?? "{}");
      if (!result) {
        result = {
          outputText: "Error: Tool call failed to return a result.",
          metadata: { exit_code: 1 },
        };
      }
      outputText = result.outputText;
      metadata = result.metadata;
    } else if (name === "semantic_search") {
      let result = await handlers.handleSemanticSearch(
        ctx,
        rawArguments ?? "{}",
      );
      if (!result) {
        result = {
          outputText: "Error: Tool call failed to return a result.",
          metadata: { exit_code: 1 },
        };
      }
      outputText = result.outputText;
      metadata = result.metadata;
    } else if (name === "npm_search") {
      let result = await handlers.handleNpmSearch(ctx, rawArguments ?? "{}");
      if (!result) {
        result = {
          outputText: "Error: Tool call failed to return a result.",
          metadata: { exit_code: 1 },
        };
      }
      outputText = result.outputText;
      metadata = result.metadata;
    } else if (name === "snyk_search") {
      let result = await handlers.handleSnykSearch(ctx, rawArguments ?? "{}");
      if (!result) {
        result = {
          outputText: "Error: Tool call failed to return a result.",
          metadata: { exit_code: 1 },
        };
      }
      outputText = result.outputText;
      metadata = result.metadata;
    } else if (name === "ask_confirmation") {
      let result = await handlers.handleAskConfirmation(
        ctx,
        rawArguments ?? "{}",
      );
      if (!result) {
        result = {
          outputText: "Error: Tool call failed to return a result.",
          metadata: { exit_code: 1 },
        };
      }
      outputText = result.outputText;
      metadata = result.metadata;
    } else if (name === "ask_multiple_choice") {
      let result = await handlers.handleAskMultipleChoice(
        ctx,
        rawArguments ?? "{}",
      );
      if (!result) {
        result = {
          outputText: "Error: Tool call failed to return a result.",
          metadata: { exit_code: 1 },
        };
      }
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
      await ctx.agent.indexCodebase(
        (curr: number, total: number, file: string) => {
          totalIndexed = total;
          const progressMsg = `Indexing progress: ${curr}/${total} - ${file}`;
          if (curr % 10 === 0) {
            log(progressMsg);
          }
          // Update UI with current progress
          onPartialUpdate?.("", progressMsg, "index_codebase", {
            current: curr,
            total,
            file,
          });
        },
      );
      // Clear progress from thinking indicator
      onPartialUpdate?.("", "", undefined, undefined);
      outputText = `Codebase indexing complete. Indexed ${totalIndexed} files.`;
      metadata = { exit_code: 0, count: totalIndexed };
    } else if (name && ctx.pluginManager.hasPlugin(name)) {
      const pluginHandler = ctx.pluginManager.getHandler(name);
      if (pluginHandler) {
        const result = await pluginHandler(ctx, rawArguments || "{}");
        outputText = result.outputText;
        metadata = result.metadata;
        additionalItems = result.additionalItems;
      }
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
      const currentErrorSnippet = outputText.slice(0, 200);
      const isIdenticalError = history.lastError === currentErrorSnippet;

      try {
        const provider = ctx.config.provider || "unknown";
        appendFileSync(
          "opencodex.error.log",
          `[${new Date().toISOString()}] Provider: ${provider}, Model: ${ctx.model}\nTool Execution Failed: ${name}\nArguments: ${rawArguments}\nExit Code: ${metadata["exit_code"]}\nOutput: ${outputText}\n\n`,
        );
      } catch {
        /* ignore logging errors */
      }

      toolCallHistory.set(toolCallKey, {
        count: isIdenticalError ? history.count + 1 : 1, // Reset if error changes
        lastError: currentErrorSnippet,
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
    } catch {
      /* ignore */
    }
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
