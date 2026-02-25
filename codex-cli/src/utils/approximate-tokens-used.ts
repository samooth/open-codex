import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";

import { getModelPricing } from "./model-pricing.js";

export type TokenBreakdown = {
  total: number;
  system: number;
  history: number;
  tools: number;
  cost: number;
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
  model: string,
  items: Array<ChatCompletionMessageParam>
): TokenBreakdown {
  let systemChars = 0;
  let userInputChars = 0;
  let assistantOutputChars = 0;
  let toolChars = 0;

  // System messages and user messages count as "input" tokens.
  // Assistant messages (responses and tool calls) count as "output" tokens.

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
      for (const toolCall of item.tool_calls as Array<any>) {
        itemChars += toolCall.function.name.length;
        itemChars += toolCall.function.arguments.length;
      }
    }

    if (item.role === "system") {
      systemChars += itemChars;
    } else if (item.role === "user") {
      userInputChars += itemChars;
    } else if (item.role === "assistant") {
      assistantOutputChars += itemChars;
    } else if (item.role === "tool") {
      toolChars += itemChars;
    }
  }

  const systemTokens = Math.ceil(systemChars / 4);
  const userInputTokens = Math.ceil(userInputChars / 4);
  const assistantOutputTokens = Math.ceil(assistantOutputChars / 4);
  const toolTokens = Math.ceil(toolChars / 4);

  const inputTokens = systemTokens + userInputTokens + toolTokens;
  const outputTokens = assistantOutputTokens;

  const total = inputTokens + outputTokens;
  const pricing = getModelPricing(model);
  let cost = 0;
  if (pricing) {
    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;
    cost = inputCost + outputCost;
  }

  // For display, we still break it down a bit differently
  const history = userInputTokens + assistantOutputTokens;

  return { total, system: systemTokens, history, tools: toolTokens, cost };
}

