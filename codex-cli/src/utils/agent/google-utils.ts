import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";
import { randomUUID } from "node:crypto";

export function mapOpenAiToGoogleMessages(
  messages: Array<ChatCompletionMessageParam>,
): { contents: any[]; systemInstruction: any } {
  const contents: any[] = [];
  let systemInstruction: any = undefined;

  for (const msg of messages) {
    if (msg.role === "system") {
      systemInstruction = { parts: [{ text: msg.content }] };
      continue;
    }

    const role = msg.role === "assistant" ? "model" : "user";
    const parts: any[] = [];

    if (msg.role === "assistant") {
      const assistant = msg as any;
      const thoughtSignature = assistant.thought_signature;

      if (assistant.reasoning_content) {
        parts.push({
          text: assistant.reasoning_content,
          thought: true,
          // Propagate thought signature to the reasoning part if available
          ...(thoughtSignature ? { thoughtSignature } : {})
        });
      }

      if (msg.content && typeof msg.content === "string") {
        parts.push({ 
          text: msg.content,
          ...(thoughtSignature ? { thoughtSignature } : {})
        });
      }
      
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls as any[]) {
          let args = {};
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            /* ignore */
          }
          parts.push({
            functionCall: {
              name: tc.function.name,
              args,
            },
            // The thoughtSignature must be at the Part level, alongside functionCall.
            ...(tc.thought_signature || thoughtSignature ? { 
              thoughtSignature: tc.thought_signature || thoughtSignature 
            } : {}),
          });
        }
      }
    } else if (msg.role === "user") {
      if (typeof msg.content === "string") {
        parts.push({ text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === "text") {
            parts.push({ text: part.text });
          }
        }
      }
    } else if (msg.role === "tool") {
      let response = {};
      try {
        response = JSON.parse(msg.content as string);
      } catch {
        response = { output: msg.content };
      }
      // For Google GenAI SDK, functionResponse needs the name.
      // We try to find it from previous messages if possible, but for now we'll assume it's passed or use a placeholder.
      // Actually, the OpenAI tool message doesn't have the name, only tool_call_id.
      // A better way is to track it, but for a simple mapping we might need to find the name from history.
      let name = "unknown";
      for (let i = messages.indexOf(msg) - 1; i >= 0; i--) {
        const prev = messages[i] as any;
        if (prev?.role === "assistant" && prev.tool_calls) {
          const tc = prev.tool_calls.find(
            (c: any) => (c.id || c.call_id) === msg.tool_call_id,
          );
          if (tc) {
            name = tc.function.name;
            break;
          }
        }
      }

      parts.push({
        functionResponse: {
          name,
          response,
        },
        // If the tool message has a thought_signature, or we found one earlier, include it.
        ...((msg as any).thought_signature ? { thoughtSignature: (msg as any).thought_signature } : {}),
      });
    }

    if (parts.length > 0) {
      // Merge consecutive roles to satisfy Google API requirements
      if (contents.length > 0 && contents[contents.length - 1].role === role) {
        contents[contents.length - 1].parts.push(...parts);
      } else {
        contents.push({ role, parts });
      }
    }
  }

  return { contents, systemInstruction };
}

export function mapOpenAiToGoogleTools(openAiTools: any[], sanitizeFn: (name: string) => string): any[] {
  const functionDeclarations: any[] = [];

  for (const tool of openAiTools) {
    if (tool.type === "function") {
      functionDeclarations.push({
        name: sanitizeFn(tool.function.name),
        description: tool.function.description,
        parameters: tool.function.parameters,
      });
    }
  }

  return functionDeclarations.length > 0
    ? [{ functionDeclarations }]
    : [];
}

export async function* googleToOpenAiStream(googleStream: any): AsyncGenerator<any> {
  let first = true;
  let lastThoughtSignature: string | undefined = undefined;
  for await (const chunk of googleStream) {
    const candidate = chunk.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    const delta: any = {};
    if (first) {
      delta.role = "assistant";
      first = false;
    }
    for (const part of parts) {
      if (part.text) {
        if (part.thought) {
          delta.reasoning_content = (delta.reasoning_content || "") + part.text;
        } else {
          delta.content = (delta.content || "") + part.text;
        }
      }
      if (part.thoughtSignature) {
        lastThoughtSignature = part.thoughtSignature;
        delta.thought_signature = part.thoughtSignature;
      }
      if (part.functionCall) {
        if (!delta.tool_calls) {
          delta.tool_calls = [];
        }
        delta.tool_calls.push({
          index: delta.tool_calls.length,
          id: randomUUID(),
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args),
          },
          // Ensure thought_signature is attached to the tool call delta if available
          ...(lastThoughtSignature ? { thought_signature: lastThoughtSignature } : {}),
        });
      }
    }

    if (Object.keys(delta).length > 0 || candidate?.finishReason) {
      yield {
        choices: [
          {
            delta,
            finish_reason: candidate?.finishReason?.toLowerCase() || null,
            thought_signature: lastThoughtSignature,
          },
        ],
      };
    }
  }
}

export function sanitizeGoogleToolName(name: string): string {
  // Gemini tool names:
  // Must start with a letter or underscore.
  // Must be alphanumeric, underscores, dots, colons, or dashes.
  // Max length 64.
  let sanitized = name.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  if (sanitized.length > 64) {
    sanitized = sanitized.slice(0, 64);
  }
  return sanitized;
}
