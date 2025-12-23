import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { createWebviewMessageHandler } from '../webview/host/createWebviewMessageHandler';
import { OPENHANDS_IMAGE_URL_PREFIX, parseBase64DataImageUrl } from '../shared/pastedImages';

describe('Pasted images host handling', () => {
  let tmpDir = '';

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oh-tab-pasted-images-'));
  });

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('persists data:image markdown and strips base64 from conversation text', async () => {
    const conversation = { sendUserMessage: vi.fn(async () => {}) } as any;
    const handler = createWebviewMessageHandler({
      context: { globalStorageUri: { fsPath: tmpDir } } as any,
      host: { postMessage: vi.fn(async () => true) },
      getConversation: () => conversation,
      getConversationMode: () => 'local',
      getConversationStoreRoot: () => undefined,
      resolveConversationStoreRoot: async () => tmpDir,
      setWebviewReadyState: () => {},
      setLastKnownLlmLabel: () => {},
      getLastKnownLlmLabel: () => null,
      flushConversationEventBacklog: () => {},
      onRenderedEventsResponse: () => {},
      onUiStateResponse: () => {},
      onHalStateResponse: () => {},
      isDevBridgeEnabled: () => false,
      getOutputChannel: () => undefined,
      fileLog: () => {},
    });

    const dataUrl = 'data:image/png;base64,AQID';
    const parsed = parseBase64DataImageUrl(dataUrl);
    expect(parsed).toBeTruthy();

    await handler({
      type: 'send',
      text: `hello\n\n![pasted.png](${dataUrl})`,
      contextFiles: [],
      attachments: [],
    });

    expect(conversation.sendUserMessage).toHaveBeenCalledTimes(1);
    const finalText = conversation.sendUserMessage.mock.calls[0][0] as string;
    expect(finalText).not.toContain('data:image/');
    expect(finalText).toContain(`${OPENHANDS_IMAGE_URL_PREFIX}${parsed!.imageId}`);

    const bytes = await fs.readFile(path.join(tmpDir, 'pasted-images', parsed!.imageId));
    expect([...bytes]).toEqual([1, 2, 3]);
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });
});

