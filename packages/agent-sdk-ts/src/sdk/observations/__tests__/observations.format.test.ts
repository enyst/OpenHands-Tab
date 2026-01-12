import { describe, expect, it } from 'vitest';
import type { ToolCall } from '../../types';
import { toolResultToLLMText } from '..';

const toolCall = (name: string, args: Record<string, unknown> | string): ToolCall => ({
  id: 'call_1',
  type: 'function',
  function: {
    name,
    arguments: typeof args === 'string' ? args : JSON.stringify(args),
  },
});

describe('observations formatting', () => {
  it('formats terminal tool output like the legacy runtime formatter', () => {
    const call = toolCall('terminal', { command: 'echo hi' });
    const text = toolResultToLLMText(call, { stdout: 'hi\n', stderr: '', exit_code: 0 });
    expect(text).toBe('$ echo hi\nhi\n[Command finished with exit code 0]');
  });

  it('formats terminal tool output with timeout marker', () => {
    const call = toolCall('terminal', { command: 'sleep 10' });
    const text = toolResultToLLMText(call, { stdout: '', stderr: '', timeout: true });
    expect(text).toBe('$ sleep 10\n[Command finished]\n[Command timed out]');
  });

  it('does not throw when terminal tool args are JSON null', () => {
    const call = toolCall('terminal', 'null');
    const text = toolResultToLLMText(call, { stdout: '', stderr: '', exit_code: 0 });
    expect(text).toBe('$ null\n[Command finished with exit code 0]');
  });

  it('formats file_editor tool output like the legacy runtime formatter', () => {
    const call = toolCall('file_editor', { command: 'view', path: '/tmp/a.txt' });
    const text = toolResultToLLMText(call, { command: 'view', path: '/tmp/a.txt', new_content: 'hello' });
    expect(text).toBe('file_editor view /tmp/a.txt\nhello');
  });

  it('formats generic objects via stable JSON stringification', () => {
    const call = toolCall('some_tool', '{}');
    const text = toolResultToLLMText(call, { ok: true });
    expect(text).toBe('{\n  "ok": true\n}');
  });

  it('returns generic string results as-is', () => {
    const call = toolCall('some_tool', '{}');
    const text = toolResultToLLMText(call, 'hello');
    expect(text).toBe('hello');
  });
});
