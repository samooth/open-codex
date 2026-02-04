import { describe, it, expect } from 'vitest';
import { flattenToolCalls } from '../src/utils/parsers.js';
import type { ChatCompletionMessageToolCall } from 'openai/resources/chat/completions.mjs';

describe('flattenToolCalls', () => {
  it('splits concatenated JSON objects in tool call arguments', () => {
    const toolCalls: Array<ChatCompletionMessageToolCall> = [
      {
        id: 'call_1',
        type: 'function',
        function: {
          name: 'read_file_lines',
          arguments: '{"end_line":3,"path":"file1.md","start_line":1}{"end_line":3,"path":"file2.md","start_line":1}'
        }
      }
    ];

    const flattened = flattenToolCalls(toolCalls);

    expect(flattened).toHaveLength(2);
    expect(flattened[0].function.name).toBe('read_file_lines');
    expect(JSON.parse(flattened[0].function.arguments).path).toBe('file1.md');
    expect(flattened[1].function.name).toBe('read_file_lines');
    expect(JSON.parse(flattened[1].function.arguments).path).toBe('file2.md');
  });

  it('inherits name from parent if extracted call is generic', () => {
    const toolCalls: Array<ChatCompletionMessageToolCall> = [
      {
        id: 'call_1',
        type: 'function',
        function: {
          name: 'read_file',
          arguments: '{"path":"file1.md"}{"path":"file2.md"}'
        }
      }
    ];

    const flattened = flattenToolCalls(toolCalls);

    expect(flattened).toHaveLength(2);
    expect(flattened[0].function.name).toBe('read_file');
    expect(flattened[1].function.name).toBe('read_file');
  });

  it('does not split valid single JSON object', () => {
    const toolCalls: Array<ChatCompletionMessageToolCall> = [
      {
        id: 'call_1',
        type: 'function',
        function: {
          name: 'read_file',
          arguments: '{"path":"file1.md"}'
        }
      }
    ];

    const flattened = flattenToolCalls(toolCalls);

    expect(flattened).toHaveLength(1);
    expect(flattened[0]).toEqual(toolCalls[0]);
  });

  it('handles multiple tool calls where only some need flattening', () => {
    const toolCalls: Array<ChatCompletionMessageToolCall> = [
      {
        id: 'call_1',
        type: 'function',
        function: {
          name: 'ls',
          arguments: '{"path":"."}'
        }
      },
      {
        id: 'call_2',
        type: 'function',
        function: {
          name: 'read_file',
          arguments: '{"path":"file1.md"}{"path":"file2.md"}'
        }
      }
    ];

    const flattened = flattenToolCalls(toolCalls);

    expect(flattened).toHaveLength(3);
    expect(flattened[0].function.name).toBe('ls');
    expect(flattened[1].function.name).toBe('read_file');
    expect(flattened[2].function.name).toBe('read_file');
  });

  it('normalizes concatenated tool calls with command alias', () => {
    const toolCalls: Array<ChatCompletionMessageToolCall> = [
      {
        id: 'call_1',
        type: 'function',
        function: {
          name: 'shell',
          arguments: '{"command":["ls"]}{"cmd":["pwd"]}'
        }
      }
    ];

    const flattened = flattenToolCalls(toolCalls);
    expect(flattened).toHaveLength(2);
    
    const args1 = JSON.parse(flattened[0].function.arguments);
    expect(args1).toHaveProperty('cmd');
    expect(args1.cmd).toEqual(['ls']);
    // verify 'command' property is removed/normalized away
    expect(args1).not.toHaveProperty('command');

    const args2 = JSON.parse(flattened[1].function.arguments);
    expect(args2).toHaveProperty('cmd');
    expect(args2.cmd).toEqual(['pwd']);
  });
});
