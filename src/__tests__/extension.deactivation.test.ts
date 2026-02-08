import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';

import {
  createMockContext,
  getMockSettings,
  mockOpenHandsTerminalLog,
  resetHarnessState,
  resolveChatView,
  setMockSettings,
} from './extension.test.harness';

describe('Deactivation', () => {
  it('disconnects the conversation in remote mode', async () => {
    resetHarnessState();
    const mockContext = createMockContext();
    const extension = await import('../extension');
    await extension.activate(mockContext);
    await resolveChatView(mockContext);

    extension.deactivate();

    const conv = (await import('@smolpaws/agent-sdk')).__getLastConversation?.();
    expect(conv?.disconnect).toHaveBeenCalled();
    expect(vscode.window.createTerminal).not.toHaveBeenCalled();
  });

  it('disposes the terminal in local mode on deactivation', async () => {
    resetHarnessState();
    setMockSettings({ ...getMockSettings(), serverUrl: '' });
    const { terminals } = mockOpenHandsTerminalLog();

    const mockContext = createMockContext();
    const extension = await import('../extension');
    await extension.activate(mockContext);
    await resolveChatView(mockContext);

    const conv = (await import('@smolpaws/agent-sdk')).__getLastConversation?.();
    conv?.emit('terminal', {
      id: 'bash-1',
      type: 'BashCommand',
      timestamp: '2025-01-01T00:00:00.000Z',
      command_id: 'tc-1',
      order: 0,
      command: 'pwd',
    });

    expect(vscode.window.createTerminal).toHaveBeenCalledTimes(1);
    const terminalInstance = terminals[0];
    expect(terminalInstance).toBeDefined();

    extension.deactivate();

    expect(conv?.disconnect).toHaveBeenCalled();
    expect(terminalInstance.dispose).toHaveBeenCalled();
  });
});
