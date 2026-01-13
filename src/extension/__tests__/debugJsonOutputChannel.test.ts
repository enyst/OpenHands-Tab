import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const appendLines: string[] = [];
  const createOutputChannel = vi.fn(() => ({
    appendLine: (line: string) => appendLines.push(line),
    show: vi.fn(),
    dispose: vi.fn(),
  }));

  return { appendLines, createOutputChannel };
});

vi.mock('vscode', () => ({
  ExtensionMode: {
    Development: 1,
    Test: 2,
    Production: 3,
  },
  workspace: {
    getConfiguration: () => ({
      get: () => false,
    }),
  },
  window: {
    createOutputChannel: mocks.createOutputChannel,
  },
}));

import * as vscode from 'vscode';
import { createDebugJsonOutputChannel } from '../debugJsonOutputChannel';

describe('createDebugJsonOutputChannel', () => {
  beforeEach(() => {
    mocks.appendLines.length = 0;
    mocks.createOutputChannel.mockClear();
  });

  it('truncates responses_reasoning_item.encrypted_content for display only', () => {
    const context = { extensionMode: vscode.ExtensionMode.Development, subscriptions: [] } as any;
    const channel = createDebugJsonOutputChannel({ context });
    expect(channel.isEnabled()).toBe(true);

    const encrypted = 'abcd0123456789wxyz';
    const payload = { responses_reasoning_item: { encrypted_content: encrypted } };
    channel.logJson('LLM_REQUEST', payload);

    expect(payload.responses_reasoning_item.encrypted_content).toBe(encrypted);
    const printed = mocks.appendLines.join('\n');
    expect(printed).toContain('"encrypted_content": "abcd…wxyz"');
  });
});
