// This file will manage the system prompt and conversation history.

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";

/*
import { prefix } from "./system-prompt.js";
*/

// Placeholder for prompt management functions
export function constructPrompts(history: Array<ChatCompletionMessageParam>): Array<ChatCompletionMessageParam> {
  console.log(history);
  throw new Error("Not implemented");
}
