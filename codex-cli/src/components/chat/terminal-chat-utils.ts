import type { Theme } from "../../utils/theme.js";
import type { ChatCompletionMessageParam, ChatCompletionMessageToolCall } from "openai/resources/chat/completions.mjs";
import type { ResponseItem } from "openai/resources/responses/responses.mjs";


import { formatCommandForDisplay } from "../../format-command.js";
import { TOOL_APPLY_PATCH, TOOL_SHELL } from "../../utils/agent/tool-constants.js";
import { approximateTokensUsed } from "../../utils/approximate-tokens-used.js";
import { parseToolCallArguments } from "../../utils/parsers.js";
import chalk, { type ForegroundColorName } from "chalk";

export interface CommandReviewDetails {
  cmd: Array<string>;
  cmdReadableText: string;
}

export function getCommandReviewDetails(
  toolCall: ChatCompletionMessageToolCall,
): CommandReviewDetails | undefined {
  if (!toolCall || toolCall.type !== "function" || !toolCall.function) {
    return undefined;
  }

  const result = parseToolCallArguments(toolCall.function.arguments);
  if (!result.success) {
    return {
      cmd: [],
      cmdReadableText: toolCall.function.arguments,
    };
  }

  if (!result.multiCall && result.args) {
    const cmd = result.args.cmd;
    if (cmd) {
      const cmdReadableText = formatCommandForDisplay(cmd);
      return {
        cmd,
        cmdReadableText,
      };
    }
  }

  return {
    cmd: [],
    cmdReadableText: `${toolCall.function.name} ${toolCall.function.arguments}`,
  };
}

export function getToolDisplayInfo(message: ChatCompletionMessageToolCall) {
  const details = getCommandReviewDetails(message);
  const toolName = (message as any)?.function?.name || "";
  const rawArgs = (message as any)?.function?.arguments || "{}";

  let args: any = {};
  try {
    args = JSON.parse(rawArgs);
  } catch {
    // ignore
  }

  let label = "command";
  let icon = "⚙️";
  let color: ForegroundColorName = "cyanBright";
  let summary = details?.cmdReadableText;

  // Semantic mapping for tools
  if (toolName.includes("read_file_lines")) {
    label = "reading lines";
    icon = "📖";
    summary = `${args.path} [${args.start_line}-${args.end_line}]`;
  } else if (toolName.includes("read_file")) {
    label = "reading file";
    icon = "📄";
    summary = args.path;
  } else if (toolName.includes("write_file")) {
    label = "writing file";
    icon = "✍️";
    summary = args.path;
  } else if (toolName.includes("delete_file")) {
    label = "deleting file";
    icon = "🗑️";
    color = "magentaBright";
    summary = args.path;
  } else if (
    toolName.includes("list_directory") ||
    toolName.includes("list_files")
  ) {
    label = "listing";
    icon = "📂";
    summary = args.path || ".";
  } else if (toolName.includes("search_codebase")) {
    label = "searching";
    icon = "🔍";
    summary = `"${args.pattern || args.query}" ${
      args.path ? `in ${args.path}` : ""
    }`;
  } else if (toolName.includes(TOOL_APPLY_PATCH)) {
    label = "patching";
    icon = "🩹";
    summary = "applying changes";
  } else if (toolName === "web_search") {
    label = "searching web";
    icon = "🌐";
    color = "cyanBright";
    summary = `"${args.query}"`;
  } else if (toolName === "fetch_url") {
    label = "fetching web";
    icon = "🌐";
    color = "cyanBright";
    summary = args.url;
  } else if (toolName.includes("memory")) {
    label = "memory";
    icon = "🧠";
    color = "cyanBright";
    summary = args.fact || args.query || args.pattern || "maintenance";
  } else if (toolName === TOOL_SHELL) {
    label = "shell";
    icon = "🐚";
    summary = details?.cmdReadableText;
  }

  return { label, icon, color, summary, toolName, details };
}

/**
 * Generates a theme object for cli-highlight based on the active UI theme.
 * This ensures syntax highlighting is consistent and doesn't use red for non-errors.
 */
export function getSyntaxHighlightTheme(theme: Theme) {
  const assistantColor = chalk[theme.assistant] || chalk.greenBright;
  const userColor = chalk[theme.user] || chalk.blueBright;
  const highlightColor = chalk[theme.highlight] || chalk.cyanBright;
  const successColor = chalk[theme.success] || chalk.green;
  const warningColor = chalk[theme.warning] || chalk.yellow;
  const dimColor = chalk[theme.dim] || chalk.gray;
  const deletionColor = chalk[theme.deletion] || chalk.magenta;

  return {
    keyword: assistantColor,
    built_in: chalk.cyan,
    type: highlightColor,
    literal: chalk.magentaBright,
    number: deletionColor,
    regexp: chalk.magentaBright,
    string: successColor,
    subst: chalk.white,
    symbol: warningColor,
    class: chalk.yellowBright,
    function: userColor,
    title: userColor,
    params: chalk.white,
    comment: dimColor,
    doctag: dimColor,
    meta: dimColor,
    'meta-keyword': dimColor,
    'meta-string': dimColor,
    section: chalk.bold,
    tag: dimColor,
    name: userColor,
    'builtin-name': chalk.cyan,
    attr: highlightColor,
    attribute: highlightColor,
    variable: chalk.white,
    'template-variable': chalk.white,
    'template-tag': dimColor,
    bullet: deletionColor,
    code: chalk.white,
    emphasis: chalk.italic,
    strong: chalk.bold,
    formula: dimColor,
    link: chalk.underline,
    quote: dimColor,
    'selector-tag': userColor,
    'selector-id': warningColor,
    'selector-class': chalk.yellowBright,
    'selector-attr': highlightColor,
    'selector-pseudo': chalk.cyan,
    addition: successColor,
    deletion: deletionColor,
    property: highlightColor,
    operator: chalk.white,
    punctuation: chalk.white,
    'attr-name': highlightColor,
    'attr-value': successColor,
    'class-name': chalk.yellowBright,
    constant: deletionColor,
    boolean: deletionColor,
  };
}


/**
 * Type‑guard that narrows a {@link ResponseItem} to one that represents a
 * user‑authored message. The OpenAI SDK represents both input *and* output
 * messages with a discriminated union where:
 *   • `type` is the string literal "message" and
 *   • `role` is one of "user" | "assistant" | "system" | "developer".
 *
 * For the purposes of de‑duplication we only care about *user* messages so we
 * detect those here in a single, reusable helper.
 */
function isUserMessage(
  item: ResponseItem,
): item is ResponseItem & { type: "message"; role: "user"; content: unknown } {
  return item.type === "message" && (item as { role?: string }).role === "user";
}

/**
 * Returns the maximum context length (in tokens) for a given model.
 * These numbers are best‑effort guesses and provide a basis for UI percentages.
 */
export function maxTokensForModel(model: string): number {
  const lower = model.toLowerCase();
  if (lower.includes("32k")) {
    return 32000;
  }
  if (lower.includes("16k")) {
    return 16000;
  }
  if (lower.includes("8k")) {
    return 8000;
  }
  if (lower.includes("4k")) {
    return 4000;
  }
  // Default to 128k for newer long‑context models
  return 128000;
}

/**
 * Calculates the percentage of tokens remaining in context for a model.
 */
export function calculateContextPercentRemaining(
  items: Array<ChatCompletionMessageParam>,
  model: string,
  forcedMaxTokens?: number,
): number {
  const breakdown = approximateTokensUsed(model, items);
  const used = breakdown.total;
  const max = forcedMaxTokens || maxTokensForModel(model);
  const remaining = Math.max(0, max - used);
  return (remaining / max) * 100;
}

/**
 * Returns a detailed token usage breakdown.
 */
export function calculateTokenBreakdown(
  model: string,
  items: Array<ChatCompletionMessageParam>,
) {
  return approximateTokensUsed(model, items);
}

/**
 * Deduplicate the stream of {@link ResponseItem}s before they are persisted in
 * component state.
 *
 * Historically we used the (optional) {@code id} field returned by the
 * OpenAI streaming API as the primary key: the first occurrence of any given
 * {@code id} “won” and subsequent duplicates were dropped.  In practice this
 * proved brittle because locally‑generated user messages don’t include an
 * {@code id}.  The result was that if a user quickly pressed <Enter> twice the
 * exact same message would appear twice in the transcript.
 *
 * The new rules are therefore:
 *   1.  If a {@link ResponseItem} has an {@code id} keep only the *first*
 *       occurrence of that {@code id} (this retains the previous behaviour for
 *       assistant / tool messages).
 *   2.  Additionally, collapse *consecutive* user messages with identical
 *       content.  Two messages are considered identical when their serialized
 *       {@code content} array matches exactly.  We purposefully restrict this
 *       to **adjacent** duplicates so that legitimately repeated questions at
 *       a later point in the conversation are still shown.
 */
export function uniqueById(items: Array<ResponseItem>): Array<ResponseItem> {
  const seenIds = new Set<string>();
  const deduped: Array<ResponseItem> = [];

  for (const item of items) {
    // ──────────────────────────────────────────────────────────────────
    // Rule #1 – de‑duplicate by id when present
    // ──────────────────────────────────────────────────────────────────
    if (typeof item.id === "string" && item.id.length > 0) {
      if (seenIds.has(item.id)) {
        continue; // skip duplicates
      }
      seenIds.add(item.id);
    }

    // ──────────────────────────────────────────────────────────────────
    // Rule #2 – collapse consecutive identical user messages
    // ──────────────────────────────────────────────────────────────────
    if (isUserMessage(item) && deduped.length > 0) {
      const prev = deduped[deduped.length - 1]!;

      if (
        isUserMessage(prev) &&
        // Note: the `content` field is an array of message parts. Performing
        // a deep compare is over‑kill here; serialising to JSON is sufficient
        // (and fast for the tiny payloads involved).
        JSON.stringify(prev.content) === JSON.stringify(item.content)
      ) {
        continue; // skip duplicate user message
      }
    }

    deduped.push(item);
  }

  return deduped;
}
