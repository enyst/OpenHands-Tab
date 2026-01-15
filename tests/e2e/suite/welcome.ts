import * as vscode from 'vscode';
import { pollUntil } from './pollUntil';

type UiStateSnapshot = {
  showWelcomeProviderKeyMessage?: boolean;
  showWelcomeGeminiKeyMessage?: boolean;
  hasWelcomeProviderKey?: boolean;
  hasWelcomeGeminiKey?: boolean;
};

async function getUiState(): Promise<UiStateSnapshot> {
  return (await vscode.commands.executeCommand('openhands._queryUiState')) as UiStateSnapshot;
}

async function waitForWelcomeMessages(options: {
  showProvider: boolean;
  showGemini: boolean;
  timeoutMs?: number;
}): Promise<UiStateSnapshot> {
  const { showProvider, showGemini, timeoutMs = 15000 } = options;

  await pollUntil(async () => {
    const state = await getUiState();
    return state.showWelcomeProviderKeyMessage === showProvider
      && state.showWelcomeGeminiKeyMessage === showGemini;
  }, timeoutMs, 200);

  return await getUiState();
}

async function setProviderKey(provider: string, apiKey: string): Promise<void> {
  await vscode.commands.executeCommand('openhands._setProviderApiKey', { provider, apiKey });
}

export async function run(): Promise<void> {
  await vscode.commands.executeCommand('openhands.open');

  await pollUntil(async () => {
    const diag: any = await vscode.commands.executeCommand('openhands._diagnostics');
    return Boolean(diag?.chat?.hasView && diag?.chat?.webviewReady);
  }, 15000);

  await vscode.commands.executeCommand('openhands.startNewConversation');

  // Ensure a deterministic baseline: no stored provider keys.
  await setProviderKey('openai', '');
  await setProviderKey('anthropic', '');
  await setProviderKey('openrouter', '');
  await setProviderKey('litellm_proxy', '');
  await setProviderKey('gemini', '');

  const initial = await waitForWelcomeMessages({ showProvider: true, showGemini: true });
  if (initial.hasWelcomeProviderKey !== false || initial.hasWelcomeGeminiKey !== false) {
    throw new Error(`Expected no keys initially but got: ${JSON.stringify(initial)}`);
  }

  // Gemini key alone should be sufficient (hide both messages).
  await setProviderKey('gemini', 'e2e-gemini-key');
  const geminiOnly = await waitForWelcomeMessages({ showProvider: false, showGemini: false });
  if (geminiOnly.hasWelcomeGeminiKey !== true) {
    throw new Error(`Expected hasWelcomeGeminiKey=true but got: ${JSON.stringify(geminiOnly)}`);
  }

  // Non-Gemini key should hide provider prompt but still show Gemini recommendation.
  await setProviderKey('gemini', '');
  await setProviderKey('openai', 'e2e-openai-key');
  const openaiOnly = await waitForWelcomeMessages({ showProvider: false, showGemini: true });
  if (openaiOnly.hasWelcomeProviderKey !== true || openaiOnly.hasWelcomeGeminiKey !== false) {
    throw new Error(`Expected provider-only keys but got: ${JSON.stringify(openaiOnly)}`);
  }
}

