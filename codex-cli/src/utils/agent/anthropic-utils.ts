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

  // 1. First Pass: Build the message list and track tool usage
  const useIdToMessageIndex = new Map<string, number>();
  const resultIds = new Set<string>();

  for (const msg of messages) {
    if (msg.role === "system") {
      system = (system ? system + "\n\n" : "") + (msg.content as string);
      continue;
    }

    let role: "user" | "assistant" = msg.role === "assistant" ? "assistant" : "user";
    let content: any[] = [];

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
          signature: assistant.thought_signature
        });
      }
      if (msg.content && typeof msg.content === "string") {
        content.push({ type: "text", text: msg.content });
      }
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls as any[]) {
          const sanitizedName = sanitizeAnthropicToolName(tc.function.name);
          content.push({
            type: "tool_use",
            id: tc.id,
            name: sanitizedName,
            input: (() => {
              try { return JSON.parse(tc.function.arguments); } 
              catch { return { raw: tc.function.arguments }; }
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
      resultIds.add(msg.tool_call_id);
    }

    if (content.length > 0) {
      const lastMsg = anthropicMessages[anthropicMessages.length - 1];
      if (lastMsg && lastMsg.role === role) {
        // Merge
        for (const newPart of content) {
          if (newPart.type === "tool_result") {
            const existingIndex = lastMsg.content.findIndex(
              (p: any) => p.type === "tool_result" && p.tool_use_id === newPart.tool_use_id
            );
            if (existingIndex !== -1) {
              lastMsg.content[existingIndex] = newPart;
            } else {
              lastMsg.content.push(newPart);
            }
            resultIds.add(newPart.tool_use_id);
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

  // 2. Second Pass: Relocate results and fill holes
  const finalMessages: any[] = [];
  
  for (let i = 0; i < anthropicMessages.length; i++) {
    const msg = anthropicMessages[i];
    
    // If this is an assistant message, we need to ensure the NEXT message handles all its tool_uses
    if (msg.role === "assistant") {
      const toolUseIds = msg.content
        .filter((p: any) => p.type === "tool_use")
        .map((p: any) => p.id);

      finalMessages.push(msg);

      if (toolUseIds.length > 0) {
        // Look ahead for the next message (must be user/tool_result)
        let nextMsg = anthropicMessages[i + 1];
        
        // If there's no next message, or the next message isn't a "user" role, 
        // we MUST inject one to hold the results.
        if (!nextMsg || nextMsg.role !== "user") {
          nextMsg = { role: "user", content: [] };
          // We don't increment `i` because we just created a placeholder
        } else {
          // It is a user message, we'll consume it now
          i++;
        }

        // Ensure every ID in toolUseIds has a result in nextMsg
        for (const id of toolUseIds) {
          const hasResult = nextMsg.content.some((p: any) => p.type === "tool_result" && p.tool_use_id === id);
          
          if (!hasResult) {
            // Check if the result exists ELSEWHERE in the original list (relocation)
            // This handles cases where OpenAI interleaved user messages between use/result
            const globalResult = findAndRemoveResult(anthropicMessages, id);
            if (globalResult) {
              nextMsg.content.push(globalResult);
            } else {
              // Hole filling: satisfy the API with a dummy result
              nextMsg.content.push({
                type: "tool_result",
                tool_use_id: id,
                content: "Execution interrupted or cancelled by user.",
                is_error: true
              });
            }
          }
        }
        
        if (nextMsg.content.length > 0) {
          finalMessages.push(nextMsg);
        }
      }
    } else {
      // For non-assistant messages, just push them if they weren't consumed as a "nextMsg"
      finalMessages.push(msg);
    }
  }

  return { messages: finalMessages, system };
}

/**
 * Heuristic to find a tool result in the future/past and remove it from its original location
 * so it can be relocated immediately after its tool_use.
 */
function findAndRemoveResult(messages: any[], toolUseId: string): any | null {
  for (const msg of messages) {
    if (msg.role === "user") {
      const idx = msg.content.findIndex((p: any) => p.type === "tool_result" && p.tool_use_id === toolUseId);
      if (idx !== -1) {
        const [result] = msg.content.splice(idx, 1);
        return result;
      }
    }
  }
  return null;
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
  let toolCallCount = 0;
  const toolIndexMap = new Map<number, number>();

  for await (const event of anthropicStream) {
    const delta: any = {};
    let finish_reason: string | null = null;

    if (event.type === "message_start") {
        // Initial message metadata
    } else if (event.type === "content_block_start") {
      if (event.content_block.type === "tool_use") {
        const index = toolCallCount++;
        toolIndexMap.set(event.index, index);
        delta.tool_calls = [{
          index,
          id: event.content_block.id,
          function: {
            name: event.content_block.name,
            arguments: "",
          },
        }];
      }
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
          delta.tool_calls = [{
            index,
            function: {
              arguments: event.delta.partial_json,
            },
          }];
        }
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
        choices: [{ delta, finish_reason }],
      };
    }
  }
}
