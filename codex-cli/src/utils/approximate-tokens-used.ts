import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";

export type TokenBreakdown = {
  total: number;
  system: number;
  history: number;
  tools: number;
};

/**
 * Roughly estimate the number of language‑model tokens represented by a list
 * of OpenAI `ResponseItem`s.
 *
 * A full tokenizer would be more accurate, but would add a heavyweight
 * dependency for only marginal benefit. Empirically, assuming ~4 characters
 * per token offers a good enough signal for displaying context‑window usage
 * to the user.
 *
 * The algorithm counts characters from the different content types we may
 * encounter and then converts that char count to tokens by dividing by four
 * and rounding up.
 */
export function approximateTokensUsed(
  items: Array<ChatCompletionMessageParam>,
): TokenBreakdown {
  let systemChars = 0;
  let historyChars = 0;
  let toolChars = 0;

  for (const item of items) {
    let itemChars = 0;
    if (typeof item.content === "string") {
      itemChars += item.content.length;
    }
    if (Array.isArray(item.content)) {
      for (const part of item.content) {
        if (part.type === "text") {
          itemChars += part.text.length;
        }
        if (part.type === "refusal") {
          itemChars += part.refusal.length;
        }
      }
    }
    if ("tool_calls" in item && item.tool_calls) {
      for (const toolCall of item.tool_calls as any[]) {
        itemChars += toolCall.function.name.length;
        itemChars += toolCall.function.arguments.length;
      }
    }

    if (item.role === "system") {
      systemChars += itemChars;
    } else if (item.role === "tool") {
      toolChars += itemChars;
    } else {
      historyChars += itemChars;
    }
  }

  const system = Math.ceil(systemChars / 4);
  const history = Math.ceil(historyChars / 4);
  const tools = Math.ceil(toolChars / 4);
  const total = system + history + tools;

  return { total, system, history, tools };
}

