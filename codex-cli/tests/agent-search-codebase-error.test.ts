import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentLoop } from '../src/utils/agent/agent-loop.js';
import OpenAI from 'openai';
import { handleExecCommand } from '../src/utils/agent/handle-exec-command.js';

vi.mock('openai');
vi.mock('../src/utils/agent/handle-exec-command.js', () => ({
  handleExecCommand: vi.fn()
}));

describe('AgentLoop search_codebase error handling', () => {
  let agent: AgentLoop;
  const onItem = vi.fn();
  const onLoading = vi.fn();
  const onReset = vi.fn();
  const getCommandConfirmation = vi.fn().mockResolvedValue({ review: 'YES' });

  beforeEach(() => {
    vi.clearAllMocks();
    agent = new AgentLoop({
      model: 'test-model',
      approvalPolicy: 'full-auto',
      onItem,
      onLoading,
      onReset,
      getCommandConfirmation,
    });
  });

  it('reports error when rg fails with exit code 127', async () => {
    (handleExecCommand as any).mockResolvedValue({
      outputText: '/bin/sh: 1: rg: not found',
      metadata: { exit_code: 127, duration_seconds: 0.1 }
    });

    const mockStream1 = {
      [Symbol.asyncIterator]: async function* () {
        yield {
          id: 'chunk-1',
          choices: [
            {
              delta: {
                role: 'assistant',
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: {
                      name: 'search_codebase',
                      arguments: JSON.stringify({ pattern: 'test' })
                    }
                  }
                ]
              },
              finish_reason: 'tool_calls',
            },
          ],
        };
      },
    };

    const mockStream2 = {
      [Symbol.asyncIterator]: async function* () {
        yield {
          id: 'chunk-2',
          choices: [
            {
              delta: {
                role: 'assistant',
                content: 'Found nothing.',
              },
              finish_reason: 'stop',
            },
          ],
        };
      },
    };

    const mockCreate = vi.fn()
      .mockResolvedValueOnce(mockStream1)
      .mockResolvedValueOnce(mockStream2);

    (OpenAI as any).prototype.chat = {
      completions: {
        create: mockCreate,
      },
    };

    await agent.run([{ role: 'user', content: 'test' }]);

    const toolMessage = onItem.mock.calls.find(call => 
      call[0].role === 'tool' && call[0].tool_call_id === 'call_1'
    );

    expect(toolMessage).toBeDefined();
    const toolOutput = JSON.parse(toolMessage![0].content);
    expect(toolOutput.output).toContain('Error: search_codebase failed with exit code 127');
    expect(toolOutput.output).toContain('rg: not found');
  });

  it('returns "No matches found." when rg exit code is 1', async () => {
    (handleExecCommand as any).mockResolvedValue({
      outputText: '',
      metadata: { exit_code: 1, duration_seconds: 0.1 }
    });

    const mockStream1 = {
      [Symbol.asyncIterator]: async function* () {
        yield {
          id: 'chunk-1',
          choices: [
            {
              delta: {
                role: 'assistant',
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: {
                      name: 'search_codebase',
                      arguments: JSON.stringify({ pattern: 'test' })
                    }
                  }
                ]
              },
              finish_reason: 'tool_calls',
            },
          ],
        };
      },
    };

    const mockCreate = vi.fn()
      .mockResolvedValueOnce(mockStream1)
      .mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          yield { id: 'c2', choices: [{ delta: { content: 'Done.' }, finish_reason: 'stop' }] };
        }
      });

    (OpenAI as any).prototype.chat = {
      completions: {
        create: mockCreate,
      },
    };

    await agent.run([{ role: 'user', content: 'test' }]);

    const toolMessage = onItem.mock.calls.find(call => 
      call[0].role === 'tool' && call[0].tool_call_id === 'call_1'
    );

    expect(toolMessage).toBeDefined();
    const toolOutput = JSON.parse(toolMessage![0].content);
    expect(toolOutput.output).toBe('No matches found.');
  });
});
