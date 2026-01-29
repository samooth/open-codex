import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentLoop } from '../src/utils/agent/agent-loop.js';
import OpenAI from 'openai';

vi.mock('openai');
vi.mock('../src/utils/agent/handle-exec-command.js', () => ({
  handleExecCommand: vi.fn().mockResolvedValue({
    outputText: 'mock output',
    metadata: { exit_code: 0, duration_seconds: 0.1 }
  })
}));

describe('AgentLoop Content Tool Call Fallback', () => {
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

  it('extracts and executes multiple tool calls from message content', async () => {
    const mockStream1 = {
      [Symbol.asyncIterator]: async function* () {
        yield {
          id: 'chunk-1',
          choices: [
            {
              delta: {
                role: 'assistant',
                content: 'Running two commands:\n{"cmd":["ls"]}\nAnd then:\n{"cmd":["cat", "README.md"]}',
              },
              finish_reason: 'stop',
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
                content: 'Done.',
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

    const toolCallMessage = onItem.mock.calls.find(call => 
      call[0].role === 'assistant' && call[0].tool_calls
    );

    expect(toolCallMessage).toBeDefined();
    expect(toolCallMessage![0].tool_calls).toHaveLength(2);
    expect(toolCallMessage![0].tool_calls![0].function.name).toBe('shell');
    expect(JSON.parse(toolCallMessage![0].tool_calls![0].function.arguments).cmd).toEqual(['ls']);
    expect(JSON.parse(toolCallMessage![0].tool_calls![1].function.arguments).cmd).toEqual(['cat', 'README.md']);
  });

  it('extracts tool calls from a string-based command', async () => {
    const mockStream = {
      [Symbol.asyncIterator]: async function* () {
        yield {
          id: 'chunk-1',
          choices: [
            {
              delta: {
                role: 'assistant',
                content: 'I will read the file now: {"command": "cat README.md"}',
              },
              finish_reason: 'stop',
            },
          ],
        };
      },
    };

    const mockCreate = vi.fn()
      .mockResolvedValueOnce(mockStream)
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

    const toolCallMessage = onItem.mock.calls.find(call => 
      call[0].role === 'assistant' && call[0].tool_calls
    );

    expect(toolCallMessage).toBeDefined();
    expect(toolCallMessage![0].tool_calls![0].function.name).toBe('shell');
    const args = JSON.parse(toolCallMessage![0].tool_calls![0].function.arguments);
    expect(args.cmd).toEqual(['cat', 'README.md']);
  });

  it('extracts and normalizes apply_patch tool calls', async () => {
    const mockStream = {
      [Symbol.asyncIterator]: async function* () {
        yield {
          id: 'chunk-1',
          choices: [
            {
              delta: {
                role: 'assistant',
                content: '{"name": "apply_patch", "arguments": {"patch": "*** Begin Patch..."}}',
              },
              finish_reason: 'stop',
            },
          ],
        };
      },
    };

    const mockCreate = vi.fn()
      .mockResolvedValueOnce(mockStream)
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

    const toolCallMessage = onItem.mock.calls.find(call => 
      call[0].role === 'assistant' && call[0].tool_calls
    );

    expect(toolCallMessage).toBeDefined();
    expect(toolCallMessage![0].tool_calls![0].function.name).toBe('shell');
    const args = JSON.parse(toolCallMessage![0].tool_calls![0].function.arguments);
    expect(args.cmd).toEqual(['apply_patch', '*** Begin Patch...']);
  });

  it('extracts tool calls from Markdown code blocks', async () => {
    const mockStream = {
      [Symbol.asyncIterator]: async function* () {
        yield {
          id: 'chunk-1',
          choices: [
            {
              delta: {
                role: 'assistant',
                content: 'I will run this:\n```bash\nls -la\n```\nAnd then this JSON:\n```json\n{"command": "cat README.md"}\n```',
              },
              finish_reason: 'stop',
            },
          ],
        };
      },
    };

    const mockCreate = vi.fn()
      .mockResolvedValueOnce(mockStream)
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

    const toolCallMessage = onItem.mock.calls.find(call => 
      call[0].role === 'assistant' && call[0].tool_calls
    );

    expect(toolCallMessage).toBeDefined();
    expect(toolCallMessage![0].tool_calls).toHaveLength(2);
    
    expect(toolCallMessage![0].tool_calls![0].function.name).toBe('shell');
    expect(JSON.parse(toolCallMessage![0].tool_calls![0].function.arguments).cmd).toEqual(['ls', '-la']);
    
    expect(toolCallMessage![0].tool_calls![1].function.name).toBe('shell');
    expect(JSON.parse(toolCallMessage![0].tool_calls![1].function.arguments).cmd).toEqual(['cat', 'README.md']);
  });

  it('extracts tool calls from a single-element array containing a full command', async () => {
    const mockStream = {
      [Symbol.asyncIterator]: async function* () {
        yield {
          id: 'chunk-1',
          choices: [
            {
              delta: {
                role: 'assistant',
                content: 'I will read the file: {"command": ["cat README.md"]}',
              },
              finish_reason: 'stop',
            },
          ],
        };
      },
    };

    const mockCreate = vi.fn()
      .mockResolvedValueOnce(mockStream)
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

    const toolCallMessage = onItem.mock.calls.find(call => 
      call[0].role === 'assistant' && call[0].tool_calls
    );

    expect(toolCallMessage).toBeDefined();
    expect(toolCallMessage![0].tool_calls![0].function.name).toBe('shell');
    const args = JSON.parse(toolCallMessage![0].tool_calls![0].function.arguments);
    expect(args.cmd).toEqual(['cat', 'README.md']);
  });

  it('handles creating a new file via Update File patch', async () => {
    const patch = `*** Begin Patch
*** Update File: new_file.txt
@@ -0,0 +1 @@
+New Content
*** End Patch`;
    
    const mockStream = {
      [Symbol.asyncIterator]: async function* () {
        yield {
          id: 'chunk-1',
          choices: [
            {
              delta: {
                role: 'assistant',
                content: JSON.stringify({ name: "shell", arguments: { command: ["apply_patch", patch] } }),
              },
              finish_reason: 'stop',
            },
          ],
        };
      },
    };

    const mockCreate = vi.fn()
      .mockResolvedValueOnce(mockStream)
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

    const toolCallMessage = onItem.mock.calls.find(call => 
      call[0].role === 'assistant' && call[0].tool_calls
    );

    expect(toolCallMessage).toBeDefined();
    expect(toolCallMessage![0].tool_calls![0].function.name).toBe('shell');
    const args = JSON.parse(toolCallMessage![0].tool_calls![0].function.arguments);
    expect(args.cmd[0]).toBe('apply_patch');
    expect(args.cmd[1]).toBe(patch);
  });

  it('extracts raw patch blocks even without JSON or code blocks', async () => {
    const patch = `*** Begin Patch
*** Update File: raw.js
@@ -0,0 +1 @@
+console.log("raw");
*** End Patch`;
    
    const mockStream = {
      [Symbol.asyncIterator]: async function* () {
        yield {
          id: 'chunk-1',
          choices: [
            {
              delta: {
                role: 'assistant',
                content: `Here is your file:\n\n${patch}\n\nHope this helps!`,
              },
              finish_reason: 'stop',
            },
          ],
        };
      },
    };

    const mockCreate = vi.fn()
      .mockResolvedValueOnce(mockStream)
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

    const toolCallMessage = onItem.mock.calls.find(call => 
      call[0].role === 'assistant' && call[0].tool_calls
    );

    expect(toolCallMessage).toBeDefined();
    expect(toolCallMessage![0].tool_calls![0].function.name).toBe('shell');
    const args = JSON.parse(toolCallMessage![0].tool_calls![0].function.arguments);
    expect(args.cmd[0]).toBe('apply_patch');
    expect(args.cmd[1]).toBe(patch);
  });
});
