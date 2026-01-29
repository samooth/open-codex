import type {
  ExecInput,
  ExecOutputMetadata,
} from "./agent/sandbox/interface.js";
import type { ChatCompletionMessageToolCall } from "openai/resources/chat/completions.mjs";
import type { ResponseFunctionToolCall } from "openai/resources/responses/responses.mjs";

import { formatCommandForDisplay } from "../format-command.js";
import { parse } from "shell-quote";
import { z } from "zod";

// The console utility import is intentionally explicit to avoid bundlers from
// including the entire `console` module when only the `log` function is
// required.

/**
 * Zod schema for tool call arguments.
 * We are intentionally permissive to handle common model hallucinations
 * while still providing structure.
 */
const ToolCallArgsSchema = z
  .object({
    // Shell / apply_patch
    command: z.union([z.string(), z.array(z.string())]).optional(),
    cmd: z.union([z.string(), z.array(z.string())]).optional(),
    patch: z.string().optional(),
    // Shared
    workdir: z.string().optional(),
    timeout: z.number().optional(),
    path: z.string().optional(),
    // read_file_lines
    start_line: z.number().optional(),
    end_line: z.number().optional(),
    // search_codebase
    pattern: z.string().optional(),
    include: z.string().optional(),
    // list_files_recursive
    depth: z.number().optional(),
  })
  .refine(
    (data) =>
      data.command ||
      data.cmd ||
      data.patch ||
      data.path ||
      data.pattern ||
      data.depth,
    {
      message:
        "Missing required property: one of 'command', 'cmd', 'patch', 'path', 'pattern', or 'depth' must be provided",
    },
  );

export type ParsedToolCallResult = 
  | { success: true; args: ExecInput; data?: any }
  | { success: true; data: any; args?: never }
  | { success: false; error: string };

export function parseToolCallOutput(toolCallOutput: string): {
  output: string;
  metadata: ExecOutputMetadata;
} {
  try {
    const { output, metadata } = JSON.parse(toolCallOutput);
    return {
      output,
      metadata,
    };
  } catch (err) {
    return {
      output: `Failed to parse JSON result`,
      metadata: {
        exit_code: 1,
        duration_seconds: 0,
      },
    };
  }
}

export type CommandReviewDetails = {
  cmd: Array<string>;
  cmdReadableText: string;
};

/**
 * Tries to parse a tool call and, if successful, returns an object that has
 * both:
 * - an array of strings to use with `ExecInput` and `canAutoApprove()`
 * - a human-readable string to display to the user
 */
export function parseToolCallChatCompletion(
  toolCall: ChatCompletionMessageToolCall,
): CommandReviewDetails | undefined {
  if (toolCall.type !== "function") {
    return undefined;
  }
  const result = parseToolCallArguments(toolCall.function.arguments);
  if (!result.success) {
    return {
      cmd: [],
      cmdReadableText: toolCall.function.arguments,
    };
  }
  if (result.args) {
    const { cmd } = result.args;
    const cmdReadableText = formatCommandForDisplay(cmd);
    return {
      cmd,
      cmdReadableText,
    };
  }
  return {
    cmd: [],
    cmdReadableText: `${toolCall.function.name} ${toolCall.function.arguments}`,
  };
}

export function parseToolCall(
  toolCall: ResponseFunctionToolCall,
): CommandReviewDetails | undefined {
  const result = parseToolCallArguments(toolCall.arguments);
  if (!result.success) {
    return {
      cmd: [],
      cmdReadableText: toolCall.arguments,
    };
  }

  if (result.args) {
    const { cmd } = result.args;
    const cmdReadableText = formatCommandForDisplay(cmd);

    return {
      cmd,
      cmdReadableText,
    };
  }

  return {
    cmd: [],
    cmdReadableText: `${toolCall.name} ${toolCall.arguments}`,
  };
}

/**
 * If toolCallArguments is a string of JSON that can be parsed into an object
 * with a "cmd" or "command" property that is an `Array<string>`, then returns
 * that array. Otherwise, returns undefined.
 */
export function parseToolCallArguments(
  toolCallArguments: string,
): ParsedToolCallResult {
  let json: unknown;
  try {
    json = JSON.parse(toolCallArguments);
  } catch (err) {
    return {
      success: false,
      error: `Failed to parse arguments as JSON: ${toolCallArguments}`,
    };
  }

  const result = ToolCallArgsSchema.safeParse(json);
  if (!result.success) {
    // Format Zod errors into a readable string for the model
    const errorMsg = result.error.errors
      .map((e) => `${e.path.join(".")}: ${e.message}`)
      .join("; ");
    return {
      success: false,
      error: `Invalid tool arguments: ${errorMsg}`,
    };
  }

  const data = result.data;
  const commandArray = toStringArray(data.cmd) ?? toStringArray(data.command);

  // If we have a command or patch, we wrap it into the ExecInput format
  if (commandArray || typeof data.patch === "string") {
    const finalCmd = 
      commandArray ?? (data.patch ? ["apply_patch", data.patch] : []);
    return {
      success: true,
      args: {
        cmd: finalCmd,
        workdir: data.workdir,
        timeoutInMillis: data.timeout,
      },
    };
  }

  // Otherwise, return the raw data object (for other tools like search_codebase)
  return {
    success: true,
    data: data,
  };
}

/**
 * Tries to extract tool calls from a string that might contain one or more JSON objects
 * or Markdown code blocks containing commands.
 */
export function tryExtractToolCallsFromContent(
  content: string,
): Array<ChatCompletionMessageToolCall> {
  const toolCalls: Array<ChatCompletionMessageToolCall> = [];

  // 1. Try to extract from Markdown code blocks (json, bash, shell)
  const codeBlockRegex = /```(?:json|bash|shell|sh)\n([\s\S]*?)\n```/g;
  let match;
  while ((match = codeBlockRegex.exec(content)) !== null) {
    const rawBlock = match[1];
    if (!rawBlock) continue;
    const blockContent = rawBlock.trim();
    if (!blockContent) continue;

    try {
      // Try to parse as JSON first
      const json = JSON.parse(blockContent);
      const normalized = normalizeJsonToolCall(json, blockContent);
      if (normalized) {
        toolCalls.push({
          id: `call_mb_${Math.random().toString(36).slice(2, 11)}_${toolCalls.length}`,
          type: "function",
          function: normalized,
        });
        continue;
      }
    } catch {
      // Not JSON, treat as a raw shell command if it's a bash/shell block
      if (!match[0].startsWith("```json")) {
        const result = parseToolCallArguments(
          JSON.stringify({ cmd: blockContent }),
        );
        if (result.success) {
          toolCalls.push({
            id: `call_mb_${Math.random().toString(36).slice(2, 11)}_${toolCalls.length}`,
            type: "function",
            function: {
              name: "shell",
              arguments: JSON.stringify({
                cmd: result.args.cmd,
              }),
            },
          });
        }
      }
    }
  }

  // If we found code blocks, we assume those are the intended tool calls
  if (toolCalls.length > 0) {
    return toolCalls;
  }

  // 2. Fallback to the existing brace-counting approach for raw JSON objects
  let braceCount = 0;
  let start = -1;

  for (let i = 0; i < content.length; i++) {
    if (content[i] === "{") {
      if (braceCount === 0) {
        start = i;
      }
      braceCount++;
    } else if (content[i] === "}") {
      braceCount--;
      if (braceCount === 0 && start !== -1) {
        const jsonStr = content.slice(start, i + 1);
        try {
          const json = JSON.parse(jsonStr);
          if (typeof json === "object" && json !== null) {
            if (
              json.name ||
              json.cmd ||
              json.command ||
              json.patch ||
              json.path ||
              json.pattern ||
              json.depth
            ) {
              const normalized = normalizeJsonToolCall(json, jsonStr);
              if (normalized) {
                toolCalls.push({
                  id: `call_${Math.random().toString(36).slice(2, 11)}_${
                    toolCalls.length
                  }`,
                  type: "function",
                  function: normalized,
                });
              }
            }
          }
        } catch (err) {
          // Ignore parse errors for individual blocks
        }
        start = -1;
      }
    }
  }

  // 3. Fallback to raw patches: *** Begin Patch ... *** End Patch
  const patchRegex = /\*\*\* Begin Patch[\s\S]*?\*\*\* End Patch/g;
  while ((match = patchRegex.exec(content)) !== null) {
    const patchText = match[0];
    // Avoid duplicates if this was already captured by JSON or Code Block logic
    if (toolCalls.some((tc) => tc.function.arguments.includes(patchText))) {
      continue;
    }

    toolCalls.push({
      id: `call_raw_${Math.random().toString(36).slice(2, 11)}_${
        toolCalls.length
      }`,
      type: "function",
      function: {
        name: "shell",
        arguments: JSON.stringify({
          cmd: ["apply_patch", patchText],
        }),
      },
    });
  }

  return toolCalls;
}

/**
 * Normalizes a JSON object into a tool call structure.
 */
function normalizeJsonToolCall(
  json: any,
  rawStr: string,
): { name: string; arguments: string } | undefined {
  if (typeof json !== "object" || json === null) {
    return undefined;
  }

  // Case 1: OpenAI tool call format: {"name": "...", "arguments": {...}}
  if (typeof json.name === "string" && json.arguments !== undefined) {
    const argsStr = 
      typeof json.arguments === "string"
        ? json.arguments
        : JSON.stringify(json.arguments);

    if (
      json.name === "search_codebase" ||
      json.name === "persistent_memory" ||
      json.name === "read_file_lines" ||
      json.name === "list_files_recursive"
    ) {
      return {
        name: json.name,
        arguments: argsStr,
      };
    }

    const result = parseToolCallArguments(argsStr);
    if (result.success) {
      const parsedArgs = result.args;
      return {
        name: json.name === "apply_patch" ? "shell" : json.name,
        arguments: JSON.stringify({
          cmd: parsedArgs.cmd,
          workdir: parsedArgs.workdir,
          timeout: parsedArgs.timeoutInMillis,
        }),
      };
    }
  }
  // Case 2: Direct command or arguments without name
  else if (json.cmd || json.command || json.patch || json.path || json.pattern || json.depth) {
    const result = parseToolCallArguments(rawStr);
    if (result.success) {
      // Infer tool name
      let toolName = "shell";
      if (json.pattern) {
        toolName = "search_codebase";
      } else if (json.start_line || json.end_line) {
        toolName = "read_file_lines";
      } else if (json.depth) {
        toolName = "list_files_recursive";
      } else if (json.fact) {
        toolName = "persistent_memory";
      }

      if (toolName === "shell") {
        return {
          name: "shell",
          arguments: JSON.stringify({
            cmd: result.args.cmd,
            workdir: result.args.workdir,
            timeout: result.args.timeoutInMillis,
          }),
        };
      }

      return {
        name: toolName,
        arguments: rawStr,
      };
    }
  }

  return undefined;
}

function toStringArray(obj: unknown): Array<string> | undefined {
  if (Array.isArray(obj) && obj.every((item) => typeof item === "string")) {
    const arrayOfStrings: Array<string> = obj;
    if (arrayOfStrings.length === 0) {
      return undefined;
    }
    if (arrayOfStrings.length === 1) {
      const first = arrayOfStrings[0];
      if (first && first.includes(" ")) {
        const tokens = parse(first);
        return tokens
          .map((t) => (typeof t === "string" ? t : undefined))
          .filter((t): t is string => t !== undefined);
      }
    }
    return arrayOfStrings;
  } else if (typeof obj === "string") {
    // If it's a single string, parse it using shell-quote to split it correctly
    const tokens = parse(obj);
    return tokens
      .map((t) => (typeof t === "string" ? t : undefined))
      .filter((t): t is string => t !== undefined);
  } else {
    return undefined;
  }
}