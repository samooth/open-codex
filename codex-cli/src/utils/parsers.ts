import { parseMultipleJSON } from "./parse_multiple_json.js";

/**
 * Enhanced parsing for multiple concatenated JSON objects
 * @param input - String potentially containing multiple JSON objects
 * @returns Parsed objects with error handling
 */
function parseMultipleJsonObjects(input: string) {
  const result = parseMultipleJSON(input, { strict: false });
  return result.objects;
}

import type {
  ExecInput,
  ExecOutputMetadata,
} from "./agent/sandbox/interface.js";
import type { ChatCompletionMessageToolCall } from "openai/resources/chat/completions.mjs";
import { formatCommandForDisplay } from "../format-command.js";
import { parse } from "shell-quote";
import { z } from "zod";

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
    // search_codebase / query_memory
    pattern: z.string().optional(),
    query: z.string().optional(),
    include: z.string().optional(),
    // persistent_memory
    fact: z.string().optional(),
    category: z.string().optional(),
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
      data.query ||
      data.fact ||
      typeof data.depth === 'number',
    {
      message:
        "Missing required property: one of 'command', 'cmd', 'patch', 'path', 'pattern', 'query', 'fact', or 'depth' must be provided",
    },
  );

// Fixed: Single, clear type definition without duplicates
export type ParsedToolCallResult = 
  | { success: true; args: ExecInput; data?: unknown; multiCall?: false }
  | { success: true; multiCall: true; results: Array<{ args?: ExecInput; data?: unknown }> }
  | { success: false; error: string };

export function parseToolCallOutput(toolCallOutput: string): {
  output: string;
  metadata: ExecOutputMetadata;
} {
  try {
    console.log("tool output:", toolCallOutput)
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

export function parseToolCall(
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

/**
 * Robust JSON splitter that handles escaped characters and whitespace
 * Split concatenated JSON objects: {"a":1}{"b":2} -> ["{"a":1}", "{"b":2}"]
 */
function splitConcatenatedJSON(str: string): string[] {
  const results: string[] = [];
  let depth = 0;
  let current = '';
  let inString = false;
  let escapeNext = false;

  for (const char of str) {
    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      current += char;
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      current += char;
      continue;
    }

    if (!inString) {
      if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
      }
    }

    current += char;

    if (depth === 0 && current.trim() && !inString) {
      results.push(current.trim());
      current = '';
    }
  }

  return results;
}

export function parseToolCallArguments(
  toolCallArguments: string,
): ParsedToolCallResult {
  // Clean the input
  const trimmed = toolCallArguments.trim();

  if (!trimmed) {
    return {
      success: false,
      error: 'Empty tool call arguments',
    };
  }

  // Try parsing as single JSON first (fast path)
  try {
    const json = JSON.parse(trimmed);
    return validateAndBuildResult(json);
  } catch {
    // Not valid single JSON, try concatenated
  }

  // Handle concatenated JSON objects (parallel execution)
  const jsonStrings = splitConcatenatedJSON(trimmed);

  if (jsonStrings.length === 0) {
    return {
      success: false,
      error: `Failed to parse arguments as JSON: ${toolCallArguments}`,
    };
  }

  if (jsonStrings.length === 1) {
    // Single object that failed initial parse (malformed)
    try {
      const json = JSON.parse(jsonStrings[0]);
      return validateAndBuildResult(json);
    } catch (err) {
      return {
        success: false,
        error: `Failed to parse arguments as JSON: ${toolCallArguments}`,
      };
    }
  }

  // Multiple tool calls - parse each one
  const results: Array<{ args?: ExecInput; data?: unknown }> = [];

  for (const jsonStr of jsonStrings) {
    try {
      const json = JSON.parse(jsonStr);
      const result = validateAndBuildResult(json);

      if (!result.success) {
        return result; // Return first validation error
      }

      // Handle both single and multi-call results
      if (result.multiCall && result.results) {
        results.push(...result.results);
      } else {
        results.push({
          args: result.args,
          data: result.data,
        });
      }
    } catch (err) {
      return {
        success: false,
        error: `Failed to parse one of ${jsonStrings.length} parallel tool calls: ${jsonStr}`,
      };
    }
  }

  // Return multi-call structure
  return {
    success: true,
    multiCall: true,
    results,
  };
}

function validateAndBuildResult(json: unknown): ParsedToolCallResult {
  const result = ToolCallArgsSchema.safeParse(json);

  if (!result.success) {
    const errorMsg = result.error.errors
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join('; ');
    return {
      success: false,
      error: `Invalid tool arguments: ${errorMsg}`,
    };
  }

  const data = result.data;
  const commandArray = toStringArray(data.cmd) ?? toStringArray(data.command);

  // If we have a command or patch, wrap it into the ExecInput format
  if (commandArray || typeof data.patch === 'string') {
    const finalCmd =
      commandArray ?? (data.patch ? ['apply_patch', data.patch] : undefined);

    if (!finalCmd) {
      return {
        success: false,
        error: 'Failed to construct command array for ExecInput',
      };
    }

    const args: ExecInput = {
      cmd: finalCmd,
      workdir: data.workdir,
      timeoutInMillis: data.timeout,
    };

    return {
      success: true,
      args,
    };
  }

  // Otherwise, return the raw data object (for other tools)
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

    let json;
    try {
      // Try to parse as JSON first
      try {
        json = JSON.parse(blockContent);
      } catch {
        // If direct JSON parsing fails, try multiple JSON parsing
        const parsedObjects = parseMultipleJsonObjects(blockContent);
        if (parsedObjects.length > 0) {
          json = parsedObjects[0]; // Take first valid object
        }
      }
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
      // Ignore JSON parse/normalize errors and fall through to bash fallback
    }

    // Not valid JSON, treat as a raw shell command if it's a bash/shell block
    if (!match[0].startsWith("```json")) {
      const result = parseToolCallArguments(
        JSON.stringify({ cmd: blockContent }),
      );
      if (result.success && result.args) {
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

  // If we found code blocks, we assume those are the intended tool calls
  if (toolCalls.length > 0) {
    return toolCalls;
  }

  // Enhanced approach using our robust JSON splitter
  const jsonStrings = splitConcatenatedJSON(content);
  if (jsonStrings.length > 0) {
    // Convert each parsed object to a tool call
    for (const jsonStr of jsonStrings) {
      try {
        const obj = JSON.parse(jsonStr);
        const normalized = normalizeJsonToolCall(obj, jsonStr);
        if (normalized) {
          toolCalls.push({
            id: `call_multi_${Math.random().toString(36).slice(2, 11)}_${toolCalls.length}`,
            type: "function",
            function: normalized,
          });
        }
      } catch {
        // Skip invalid JSON
      }
    }
    if (toolCalls.length > 0) {
      return toolCalls;
    }
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
 * Splits tool calls that have multiple concatenated JSON objects in their arguments.
 * Fixed: Properly handles const arrays and tool name inheritance
 */
export function flattenToolCalls(
  toolCalls: Array<ChatCompletionMessageToolCall>,
): Array<ChatCompletionMessageToolCall> {
  const result: Array<ChatCompletionMessageToolCall> = [];

  for (const tc of toolCalls) {
    if (tc.type !== "function") {
      result.push(tc);
      continue;
    }

    const args = tc.function.arguments;

    // Heuristic: concatenated JSON objects usually have "}{"
    if (!args.trim().includes("}{")) {
      result.push(tc);
      continue;
    }

    // Use the robust splitter
    const jsonStrings = splitConcatenatedJSON(args);

    if (jsonStrings.length <= 1) {
      result.push(tc);
      continue;
    }

    // Create separate tool calls for each JSON object
    for (const jsonStr of jsonStrings) {
      try {
        const json = JSON.parse(jsonStr);
        const normalized = normalizeJsonToolCall(json, jsonStr);

        if (normalized) {
          // If the extracted call has a generic 'shell' name but parent has specific name, inherit it
          const toolName = (normalized.name === "shell" && tc.function.name && tc.function.name !== "shell") 
            ? tc.function.name 
            : normalized.name;

          result.push({
            id: `call_flatten_${Math.random().toString(36).slice(2, 11)}_${result.length}`,
            type: "function",
            function: {
              name: toolName,
              arguments: normalized.arguments,
            },
          });
        }
      } catch {
        // If parsing fails for this segment, skip it or add original?
        // We'll skip to avoid duplicating the original broken call
      }
    }
  }

  return result;
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
      json.name === "query_memory" ||
      json.name === "forget_memory" ||
      json.name === "maintain_memory" ||
      json.name === "summarize_memory" ||
      json.name === "read_file_lines" ||
      json.name === "list_files_recursive" ||
      json.name === "read_file" ||
      json.name === "write_file" ||
      json.name === "delete_file" ||
      json.name === "list_directory" ||
      (json.name.startsWith("repo_browser.") && json.name !== "repo_browser.exec")
    ) {
      return {
        name: json.name,
        arguments: argsStr,
      };
    }

    const result = parseToolCallArguments(argsStr);
    if (result.success) {
      const parsedArgs = result.args;
      if (!parsedArgs) {
        // If it's a known tool name but failed to construct ExecInput args,
        // we can still return it if it's one of the other tools.
        return {
          name: json.name,
          arguments: argsStr,
        };
      }
      return {
        name: (json.name === "apply_patch" || json.name === "repo_browser.exec" || json.name === "shell") ? "shell" : json.name,
        arguments: JSON.stringify({
          cmd: parsedArgs.cmd,
          workdir: parsedArgs.workdir,
          timeout: parsedArgs.timeoutInMillis,
        }),
      };
    }
  }
  // Case 2: Direct command or arguments without name
  else if (json.cmd || json.command || json.patch || json.path || json.pattern || json.query || json.fact || json.depth) {
    const result = parseToolCallArguments(rawStr);
    if (result.success) {
      // Infer tool name
      let toolName = "shell";
      if (json.pattern) {
        toolName = "search_codebase";
      } else if (json.query) {
        toolName = "query_memory";
      } else if (json.start_line || json.end_line) {
        toolName = "read_file_lines";
      } else if (json.content !== undefined) {
        toolName = "write_file";
      } else if (json.depth) {
        toolName = "list_files_recursive";
      } else if (json.fact) {
        toolName = "persistent_memory";
      } else if (json.path && !json.cmd && !json.command && !json.patch) {
        // Ambiguous path property - could be read_file, delete_file or list_directory.
        // We'll default to read_file as it's the safest/most common.
        toolName = "read_file";
      }

      if (json.name === "repo_browser.read_file_lines") {
        toolName = "read_file_lines";
      }
      const parsedArgs = result.args;
      if (toolName === "shell" && parsedArgs) {
        return {
          name: "shell",
          arguments: JSON.stringify({
            cmd: parsedArgs.cmd,
            workdir: parsedArgs.workdir,
            timeout: parsedArgs.timeoutInMillis,
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
