import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentLoop } from '../src/utils/agent/agent-loop.js';
import { handleExecCommand } from '../src/utils/agent/handle-exec-command.js';

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
    };

    // First attempt: call handler
    const result1 = await (agent as any).handleFunctionCall(assistantMsg);
    expect(result1[0].content).toContain('Error: Permission denied');

    // Second attempt: call handler again with exact same message
    const result2 = await (agent as any).handleFunctionCall(assistantMsg);
    expect(result2[0].content).toContain('Error: Permission denied');

    // Third attempt: should trigger loop protection
    const result3 = await (agent as any).handleFunctionCall(assistantMsg);
    expect(result3[0].content).toContain('Loop detected');
    const content3 = JSON.parse(result3[0].content);
    expect(content3.metadata.loop_detected).toBe(true);
  });
});