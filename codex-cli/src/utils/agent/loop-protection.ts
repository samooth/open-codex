// Loop protection and tool call history management
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions/completions.mjs";

/**
 * Checks if a tool call has been attempted too many times and should be stopped
 * @param toolCallKey - Unique identifier for the tool call (name + arguments)
 * @param toolCallHistory - Map tracking tool call history
 * @returns True if loop is detected, false otherwise
 */
export function checkLoopDetection(
  toolCallKey: string,
  toolCallHistory: Map<string, { count: number; lastError?: string }>
): boolean {
  const history = toolCallHistory.get(toolCallKey) || { count: 0 };
  return history.count >= 2;
}

/**
 * Creates a loop detection error response
 * @param toolCallKey - Unique identifier for the tool call
 * @param toolCallHistory - Map tracking tool call history
 * @param callId - Tool call ID
 * @returns ChatCompletionMessageParam with error response
 */
export function createLoopErrorResponse(
  toolCallKey: string,
  toolCallHistory: Map<string, { count: number; lastError?: string }>,
  callId: string
): ChatCompletionMessageParam {
  const history = toolCallHistory.get(toolCallKey) || { count: 0 };
  return {
    role: "tool",
    tool_call_id: callId,
    content: JSON.stringify({
      output: `Error: Loop detected. This exact tool call has been attempted ${history.count} times already and failed with: "${history.lastError}". Please stop and ask the user for clarification instead of retrying again.`,
      metadata: { exit_code: 1, duration_seconds: 0, loop_detected: true },
    }),
  } as ChatCompletionMessageParam;
}

/**
 * Updates tool call history after execution
 * @param toolCallKey - Unique identifier for the tool call
 * @param toolCallHistory - Map tracking tool call history
 * @param metadata - Metadata from tool execution
 */
export function updateToolCallHistory(
  toolCallKey: string,
  toolCallHistory: Map<string, { count: number; lastError?: string }>,
  metadata: Record<string, unknown>
): void {
  if (metadata["exit_code"] !== 0) {
    const history = toolCallHistory.get(toolCallKey) || { count: 0 };
    toolCallHistory.set(toolCallKey, {
      count: history.count + 1,
      lastError: (metadata["exit_code"] === 1) ? String(metadata["output"] || "").slice(0, 200) : undefined,
    });
  } else {
    // If it succeeded, we can clear it from history or at least reset count
    toolCallHistory.delete(toolCallKey);
  }
}