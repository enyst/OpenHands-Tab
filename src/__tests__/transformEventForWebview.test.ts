import { describe, it, expect } from 'vitest';
import { transformEventForWebview } from '../conversation/host/transformEventForWebview';
import { OPENHANDS_IMAGE_URL_PREFIX } from '../shared/pastedImages';

describe('transformEventForWebview', () => {
  it('rewrites openhands-image URLs to webview resource URIs', () => {
    const imageId = '0123456789abcdef.png';
    const baseDir = '/tmp/oh-tab-test';
    const webview = {
      asWebviewUri: (uri: any) => ({
        toString: () => `vscode-webview-resource://test${uri.fsPath}`,
      }),
    } as any;

    const event: any = {
      kind: 'MessageEvent',
      source: 'user',
      llm_message: {
        role: 'user',
        content: [{ type: 'text', text: `![img](${OPENHANDS_IMAGE_URL_PREFIX}${imageId})` }],
      },
    };

    const transformed: any = transformEventForWebview(event, { webview, pastedImagesBaseDir: baseDir });
    const text = transformed.llm_message.content[0].text;
    expect(text).toContain('vscode-webview-resource://');
    expect(text).toContain('/tmp/oh-tab-test/pasted-images/0123456789abcdef.png');
    expect(text).not.toContain(OPENHANDS_IMAGE_URL_PREFIX);
  });

  it('summarizes error events for webview display', () => {
    const event: any = {
      kind: 'ConversationErrorEvent',
      source: 'agent',
      detail:
        "LLM request failed (400): {\"error\":{\"message\":\"Unsupported parameter: 'temperature' is not supported with this model.\"}} (mode=local, llm.model=gpt-5)",
    };

    const transformed: any = transformEventForWebview(event, { webview: {} as any, pastedImagesBaseDir: '/tmp' });
    expect(transformed.detail).toBe(
      "LLM request failed (400): Unsupported parameter: 'temperature' is not supported with this model.",
    );
    expect(transformed.hint).toContain('temperature');
  });
});
