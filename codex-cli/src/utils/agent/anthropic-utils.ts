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
): { messages: any[]; system: string | undefined } {
  const anthropicMessages: any[] = [];
  let system: string | undefined = undefined;

  for (const msg of messages) {
    if (msg.role === "system") {
      system = (system ? system + "\n\n" : "") + (msg.content as string);
      continue;
    }

    if (msg.role === "user") {
      const content: any[] = [];
      if (typeof msg.content === "string") {
        content.push({ type: "text", text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === "text") {
            content.push({ type: "text", text: part.text });
          }
        }
      }
      anthropicMessages.push({ role: "user", content });
    } else if (msg.role === "assistant") {
      const content: any[] = [];
      const assistant = msg as any;
      
      if (assistant.reasoning_content) {
        content.push({
          type: "thinking",
          thinking: assistant.reasoning_content,
          signature: assistant.thought_signature
        });
      }

      if (msg.content && typeof msg.content === "string") {
        content.push({ type: "text", text: msg.content });
      }

      if (msg.tool_calls) {
        for (const tc of msg.tool_calls as any[]) {
          let input = {};
          try {
            input = JSON.parse(tc.function.arguments);
          } catch {
            /* ignore */
          }
          content.push({
            type: "tool_use",
            id: tc.id,
            name: sanitizeAnthropicToolName(tc.function.name),
            input,
          });
        }
      }
      anthropicMessages.push({ role: "assistant", content });
    } else if (msg.role === "tool") {
      // Anthropic expects tool results as a user message with tool_result blocks
      const lastMsg = anthropicMessages[anthropicMessages.length - 1];
      if (lastMsg && lastMsg.role === "user" && Array.isArray(lastMsg.content)) {
        lastMsg.content.push({
          type: "tool_result",
          tool_use_id: msg.tool_call_id,
          content: msg.content,
        });
      } else {
        anthropicMessages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: msg.tool_call_id,
              content: msg.content,
            },
          ],
        });
      }
    }
  }

  return { messages: anthropicMessages, system };
}

export function mapOpenAiToAnthropicTools(openAiTools: any[]): any[] {
  return openAiTools.map((tool) => ({
    name: sanitizeAnthropicToolName(tool.function.name),
    description: tool.function.description,
    input_schema: tool.function.parameters,
  }));
}

export async function* anthropicToOpenAiStream(anthropicStream: AsyncIterable<any>): AsyncGenerator<any> {
  let first = true;
  let currentToolCall: any = null;

  for await (const event of anthropicStream) {
    const delta: any = {};
    let finish_reason: string | null = null;

    if (event.type === "message_start") {
        // Initial message metadata if needed
    } else if (event.type === "content_block_start") {
      if (event.content_block.type === "tool_use") {
        currentToolCall = {
          index: event.index,
          id: event.content_block.id,
          function: {
            name: event.content_block.name, // The model will return the sanitized name
            arguments: "",
          },
        };
      }
    } else if (event.type === "content_block_delta") {
      if (event.delta.type === "text_delta") {
        delta.content = event.delta.text;
      } else if (event.delta.type === "thinking_delta") {
        delta.reasoning_content = event.delta.thinking;
      } else if (event.delta.type === "signature_delta") {
        delta.thought_signature = event.delta.signature;
      } else if (event.delta.type === "input_json_delta") {
        if (currentToolCall) {
          currentToolCall.function.arguments += event.delta.partial_json;
        }
      }
    } else if (event.type === "content_block_stop") {
      if (currentToolCall) {
        if (!delta.tool_calls) delta.tool_calls = [];
        delta.tool_calls.push(currentToolCall);
        currentToolCall = null;
      }
    } else if (event.type === "message_delta") {
      if (event.delta.stop_reason) {
        finish_reason = event.delta.stop_reason === "end_turn" ? "stop" : event.delta.stop_reason;
      }
    }

    if (first && (delta.content || delta.reasoning_content || delta.tool_calls)) {
      delta.role = "assistant";
      first = false;
    }

    if (Object.keys(delta).length > 0 || finish_reason) {
      yield {
        choices: [
          {
            delta,
            finish_reason,
          },
        ],
      };
    }
  }
}
