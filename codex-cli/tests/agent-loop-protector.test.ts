import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentLoop } from '../src/utils/agent/agent-loop.js';
import { handleExecCommand } from '../src/utils/agent/handle-exec-command.js';
import { handleFunctionCall } from '../src/utils/agent/function-call-handler.js';

vi.mock('openai');
vi.mock('../src/utils/agent/handle-exec-command.js', () => ({
  handleExecCommand: vi.fn()
}));

describe('AgentLoop Protector (Loop Detection)', () => {
  let agent: AgentLoop;
  const onItem = vi.fn();
  const onLoading = vi.fn();
  const onReset = vi.fn();
  const getCommandConfirmation = vi.fn().mockResolvedValue({ review: 'YES' });

  beforeEach(() => {
    vi.clearAllMocks();
    agent = new AgentLoop({
      model: 'test-model',
      config: {
        model: 'test-model',
        apiKey: 'dummy-key',
        instructions: '',
      },
      approvalPolicy: 'full-auto',
      onItem,
      onLoading,
      onReset,
      getCommandConfirmation,
    });
  });

  it('detects a loop and stops execution after 2 identical failures', async () => {
    // Mock a failing command
    (handleExecCommand as any).mockResolvedValue({
      outputText: 'Error: Permission denied',
      metadata: { exit_code: 1, duration_seconds: 0.1 }
    });

    const mockToolCall = {
      id: 'call_1',
      type: 'function',
      function: {
        name: 'shell',
        arguments: JSON.stringify({ command: ['ls', '/root'] })
      }
    };

    const assistantMsg = {
      role: 'assistant',
      tool_calls: [mockToolCall]
    } as any;

    const ctx = {
      config: (agent as any).config,
      approvalPolicy: (agent as any).approvalPolicy,
      execAbortController: (agent as any).execAbortController,
      getCommandConfirmation: (agent as any).getCommandConfirmation,
      onItem: (agent as any).onItem,
      onFileAccess: (agent as any).onFileAccess,
      oai: (agent as any).oai,
      model: (agent as any).model,
      agent: agent,
    } as any;
    const toolCallHistory = (agent as any).toolCallHistory;

    // First attempt: call handler
    const result1 = await handleFunctionCall(ctx, assistantMsg, toolCallHistory, onLoading);
    expect(result1[0]!.content).toContain('Error: Permission denied');

    // Second attempt: call handler again with exact same message
    const result2 = await handleFunctionCall(ctx, assistantMsg, toolCallHistory, onLoading);
    expect(result2[0]!.content).toContain('Error: Permission denied');

    // Third attempt: should trigger loop protection
    const result3 = await handleFunctionCall(ctx, assistantMsg, toolCallHistory, onLoading);
    expect(result3[0]!.content).toContain('Loop detected');
    const content3 = JSON.parse(result3[0]!.content as string);
    expect(content3.metadata.loop_detected).toBe(true);
  });
});