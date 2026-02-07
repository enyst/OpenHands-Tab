import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';

import { createMockContext, resetHarnessState, resolveChatView } from './extension.test.harness';

describe('Deactivation', () => {
  it('disconnects the conversation and disposes terminal', async () => {
    resetHarnessState();
    const mockContext = createMockContext();
    const extension = await import('../extension');
    await extension.activate(mockContext);
    await resolveChatView(mockContext);

    extension.deactivate();

    const conv = (await import('@openhands/agent-sdk-ts')).__getLastConversation?.();
    expect(conv?.disconnect).toHaveBeenCalled();
    expect(vscode.window.createTerminal).not.toHaveBeenCalled();
  });
});
