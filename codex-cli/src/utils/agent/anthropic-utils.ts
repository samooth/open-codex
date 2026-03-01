import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";

export function sanitizeAnthropicToolName(name: string): string {
  // Anthropic tool names: ^[a-zA-Z0-9_-]{1,128}$
  let sanitized = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  if (sanitized.length > 128) {
    sanitized = sanitized.slice(0, 128);
  }
  return sanitized;
}

export function mapOpenAiToAnthropicMessages(
  messages: Array<ChatCompletionMessageParam>,
): { messages: Array<any>; system: Array<any> | undefined } {
  const anthropicMessages: Array<any> = [];
  const systemBlocks: Array<any> = [];

  // 1. First Pass: Build the initial message list and track tool usage
  const useIdToMessageIndex = new Map<string, number>();

  for (const msg of messages) {
    if (msg.role === "system") {
      systemBlocks.push({ type: "text", text: msg.content as string });
      continue;
    }

    let role: "user" | "assistant" =
      msg.role === "assistant" ? "assistant" : "user";
    const content: Array<any> = [];

    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        content.push({ type: "text", text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === "text") {
            content.push({ type: "text", text: part.text });
          }
        }
      }
    } else if (msg.role === "assistant") {
      const assistant = msg as any;
      if (assistant.reasoning_content) {
        content.push({
          type: "thinking",
          thinking: assistant.reasoning_content,
          signature: assistant.thought_signature,
        });
      }
      if (msg.content && typeof msg.content === "string") {
        content.push({ type: "text", text: msg.content });
      }
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls as Array<any>) {
          const sanitizedName = sanitizeAnthropicToolName(tc.function.name);
          content.push({
            type: "tool_use",
            id: tc.id,
            name: sanitizedName,
            input: (() => {
              try {
                return JSON.parse(tc.function.arguments);
              } catch {
                return { raw: tc.function.arguments };
              }
            })(),
          });
        }
      }
    } else if (msg.role === "tool") {
      role = "user";
      content.push({
        type: "tool_result",
        tool_use_id: msg.tool_call_id,
        content: msg.content,
      });
    }

    if (content.length > 0) {
      const lastMsg = anthropicMessages[anthropicMessages.length - 1];
      if (lastMsg && lastMsg.role === role) {
        // Merge consecutive roles
        for (const newPart of content) {
          if (newPart.type === "tool_result") {
            const existingIndex = lastMsg.content.findIndex(
              (p: any) =>
                p.type === "tool_result" &&
                p.tool_use_id === newPart.tool_use_id,
            );
            if (existingIndex !== -1) {
              lastMsg.content[existingIndex] = newPart;
            } else {
              lastMsg.content.push(newPart);
            }
          } else {
            lastMsg.content.push(newPart);
          }
        }
      } else {
        const newIdx = anthropicMessages.length;
        anthropicMessages.push({ role, content });
        if (role === "assistant") {
          for (const p of content) {
            if (p.type === "tool_use") {
              useIdToMessageIndex.set(p.id, newIdx);
            }
          }
        }
      }
    }
  }

  // 2. Second Pass: Relocate results, fill holes, and purge empty messages
  const finalMessages: Array<any> = [];

  for (let i = 0; i < anthropicMessages.length; i++) {
    const msg = anthropicMessages[i];

    if (msg.role === "assistant") {
      const toolUseIds = msg.content
        .filter((p: any) => p.type === "tool_use")
        .map((p: any) => p.id);

      finalMessages.push(msg);

      if (toolUseIds.length > 0) {
        // Find or create the next user message to hold the results
        let nextMsg = anthropicMessages[i + 1];
        if (!nextMsg || nextMsg.role !== "user") {
          nextMsg = { role: "user", content: [] };
        } else {
          i++; // Consume existing user message
        }

        for (const id of toolUseIds) {
          const hasResult = nextMsg.content.some(
            (p: any) => p.type === "tool_result" && p.tool_use_id === id,
          );
          if (!hasResult) {
            const globalResult = findAndRemoveResult(anthropicMessages, id);
            nextMsg.content.push(
              globalResult || {
                type: "tool_result",
                tool_use_id: id,
                content: "Execution interrupted or cancelled by user.",
                is_error: true,
              },
            );
          }
        }

        if (nextMsg.content.length > 0) {
          finalMessages.push(nextMsg);
        }
      }
    } else {
      // Push user message only if it still has content after relocations
      if (msg.content.length > 0) {
        finalMessages.push(msg);
      }
    }
  }

  // 3. Add Cache Control (Ephemeral)
  // We use the 4 breakpoints limit from Anthropic.
  // 1. System prompt (if long enough)
  // 2. Tools (handled in mapOpenAiToAnthropicTools)
  // 3. Last turn of history (if history is long)

  if (finalMessages.length >= 4) {
    // Add cache_control to the second-to-last user turn to cache most of history
    // while keeping the very latest turn dynamic.
    const targetIdx = finalMessages.length - 2;
    const targetMsg = finalMessages[targetIdx];
    if (targetMsg && targetMsg.content.length > 0) {
      const lastPart = targetMsg.content[targetMsg.content.length - 1];
      lastPart.cache_control = { type: "ephemeral" };
    }
  }

  return {
    messages: finalMessages,
    system: systemBlocks.length > 0 ? systemBlocks : undefined,
  };
}

function findAndRemoveResult(
  messages: Array<any>,
  toolUseId: string,
): any | null {
  for (const msg of messages) {
    if (msg.role === "user") {
      const idx = msg.content.findIndex(
        (p: any) => p.type === "tool_result" && p.tool_use_id === toolUseId,
      );
      if (idx !== -1) {
        return msg.content.splice(idx, 1)[0];
      }
    }
  }
  return null;
}

export function mapOpenAiToAnthropicTools(openAiTools: Array<any>): Array<any> {
  const tools = openAiTools.map((tool) => ({
    name: sanitizeAnthropicToolName(tool.function.name),
    description: tool.function.description,
    input_schema: tool.function.parameters,
  }));

  // Add cache_control to the last tool to cache the entire tools list
  if (tools.length > 0) {
    (tools[tools.length - 1] as any).cache_control = { type: "ephemeral" };
  }

  return tools;
}

export async function* anthropicToOpenAiStream(
  anthropicStream: AsyncIterable<any>,
): AsyncGenerator<any> {
  let first = true;
  let toolCallCount = 0;
  const toolIndexMap = new Map<number, number>();

  for await (const event of anthropicStream) {
    const delta: any = {};
    let finish_reason: string | null = null;

    if (
      event.type === "content_block_start" &&
      event.content_block.type === "tool_use"
    ) {
      const index = toolCallCount++;
      toolIndexMap.set(event.index, index);
      delta.tool_calls = [
        {
          index,
          id: event.content_block.id,
          function: { name: event.content_block.name, arguments: "" },
        },
      ];
    } else if (event.type === "content_block_delta") {
      if (event.delta.type === "text_delta") {
        delta.content = event.delta.text;
      } else if (event.delta.type === "thinking_delta") {
        delta.reasoning_content = event.delta.thinking;
      } else if (event.delta.type === "signature_delta") {
        delta.thought_signature = event.delta.signature;
      } else if (event.delta.type === "input_json_delta") {
        const index = toolIndexMap.get(event.index);
        if (typeof index === "number") {
          delta.tool_calls = [
            { index, function: { arguments: event.delta.partial_json } },
          ];
        }
      }
    } else if (event.type === "message_delta" && event.delta.stop_reason) {
      finish_reason =
        event.delta.stop_reason === "end_turn"
          ? "stop"
          : event.delta.stop_reason;
    }

    if (
      first &&
      (delta.content || delta.reasoning_content || delta.tool_calls)
    ) {
      delta.role = "assistant";
      first = false;
    }

    if (Object.keys(delta).length > 0 || finish_reason) {
      yield { choices: [{ delta, finish_reason }] };
    }
  }
}
