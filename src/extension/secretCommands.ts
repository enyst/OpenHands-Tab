import * as vscode from 'vscode';
import { SettingsManager, type OpenHandsSettings } from '../settings/SettingsManager';
import { VscodeSettingsAdapter } from '../settings/VscodeSettingsAdapter';
import type { ConversationInstance, SecretRegistry } from '@openhands/agent-sdk-ts';

type SecretKey = keyof OpenHandsSettings['secrets'];

const SECRET_STATUS_SET_VALUE = '✓ set';

async function syncSecretStatusIndicators(params: { context: vscode.ExtensionContext }): Promise<void> {
  const cfg = vscode.workspace.getConfiguration();

  const getIsSetFromSecretStorage = async (storageKey: string): Promise<boolean> => {
    const value = await params.context.secrets.get(storageKey);
    return typeof value === 'string' && value.trim().length > 0;
  };

  let settingsSecrets: OpenHandsSettings['secrets'] | undefined;
  try {
    const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(params.context));
    settingsSecrets = (await settingsMgr.get())?.secrets;
  } catch {
    // Best-effort: do not surface errors for a purely UX indicator.
    settingsSecrets = undefined;
  }

  const getIsSetFromSettingsSecrets = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0;

  const indicators: Array<{ key: string; isSet: boolean }> = [
    { key: 'openhands.secrets.openaiApiKey', isSet: await getIsSetFromSecretStorage('OPENAI_API_KEY') },
    { key: 'openhands.secrets.anthropicApiKey', isSet: await getIsSetFromSecretStorage('ANTHROPIC_API_KEY') },
    { key: 'openhands.secrets.openrouterApiKey', isSet: await getIsSetFromSecretStorage('OPENROUTER_API_KEY') },
    { key: 'openhands.secrets.litellmApiKey', isSet: await getIsSetFromSecretStorage('LITELLM_API_KEY') },
    { key: 'openhands.secrets.geminiLlmApiKey', isSet: await getIsSetFromSecretStorage('GEMINI_API_KEY') },

    { key: 'openhands.secrets.sessionApiKey', isSet: getIsSetFromSettingsSecrets(settingsSecrets?.sessionApiKey) },
    { key: 'openhands.secrets.githubToken', isSet: getIsSetFromSettingsSecrets(settingsSecrets?.githubToken) },
    { key: 'openhands.secrets.elevenLabsApiKey', isSet: getIsSetFromSettingsSecrets(settingsSecrets?.elevenLabsApiKey) },
    { key: 'openhands.secrets.customSecret1', isSet: getIsSetFromSettingsSecrets(settingsSecrets?.customSecret1) },
    { key: 'openhands.secrets.customSecret2', isSet: getIsSetFromSettingsSecrets(settingsSecrets?.customSecret2) },
    { key: 'openhands.secrets.customSecret3', isSet: getIsSetFromSettingsSecrets(settingsSecrets?.customSecret3) },
  ];

  for (const indicator of indicators) {
    const desired = indicator.isSet ? SECRET_STATUS_SET_VALUE : undefined;
    const inspection = cfg.inspect<string>(indicator.key);
    const currentGlobal = inspection?.globalValue;
    if (currentGlobal === desired) continue;

    await cfg.update(indicator.key, desired, vscode.ConfigurationTarget.Global);
  }
}

export function registerSecretCommands(params: {
  context: vscode.ExtensionContext;
  secrets: SecretRegistry;
  getConversation: () => ConversationInstance | undefined;
}): vscode.Disposable[] {
  const syncSecretStatusIndicatorsBestEffort = async (): Promise<void> => {
    try {
      await syncSecretStatusIndicators({ context: params.context });
    } catch {
      // Best-effort; never block activation or secret updates.
    }
  };

  const registerSecretCommand = (
    commandId: string,
    options: {
      title: string;
      secretKey: SecretKey;
      prompt: string;
      placeHolder?: string;
      successMessage: string;
      clearedMessage: string;
      errorPrefix: string;
    }
  ) =>
    vscode.commands.registerCommand(commandId, async () => {
      try {
        const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(params.context));
        const existing = await settingsMgr.get();
        const currentValue = existing.secrets[options.secretKey];
        const isCurrentlySet = typeof currentValue === 'string' && currentValue.trim().length > 0;

        if (isCurrentlySet) {
          const action = await vscode.window.showQuickPick(
            [
              { label: 'Update', value: 'update', description: 'Enter a new value (stored securely)' },
              { label: 'Clear', value: 'clear', description: 'Remove the stored value' },
            ],
            {
              title: options.title,
              placeHolder: 'Choose an action',
              canPickMany: false,
            }
          );
          if (!action) return;

          if (action.value === 'clear') {
            const confirmed = await vscode.window.showWarningMessage(
              `Clear ${options.title}?`,
              { modal: true },
              'Clear'
            );
            if (confirmed !== 'Clear') return;

            const secretsUpdate = { [options.secretKey]: undefined } as Partial<OpenHandsSettings['secrets']>;
            await settingsMgr.update({ secrets: secretsUpdate });
            vscode.window.showInformationMessage(options.clearedMessage);

            const newSettings = await settingsMgr.get();
            params.getConversation()?.setSettings(newSettings);
            await syncSecretStatusIndicatorsBestEffort();
            return;
          }
        }

        const value = await vscode.window.showInputBox({
          title: options.title,
          password: true,
          prompt: options.prompt,
          placeHolder: options.placeHolder,
        });

        if (value === undefined) return;

        const trimmed = value.trim();
        if (!trimmed) return;

        const secretsUpdate = { [options.secretKey]: trimmed } as Partial<OpenHandsSettings['secrets']>;
        await settingsMgr.update({ secrets: secretsUpdate });
        vscode.window.showInformationMessage(options.successMessage);

        const newSettings = await settingsMgr.get();
        params.getConversation()?.setSettings(newSettings);
        await syncSecretStatusIndicatorsBestEffort();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`${options.errorPrefix}: ${message}`);
      }
    });

  const registerSecretStorageCommand = (
    commandId: string,
    options: {
      title: string;
      storageKey: string;
      prompt: string;
      placeHolder?: string;
      successMessage: string;
      clearedMessage: string;
      errorPrefix: string;
    }
  ) =>
    vscode.commands.registerCommand(commandId, async () => {
      try {
        const currentValue = await params.context.secrets.get(options.storageKey);
        const isCurrentlySet = typeof currentValue === 'string' && currentValue.trim().length > 0;

        if (isCurrentlySet) {
          const action = await vscode.window.showQuickPick(
            [
              { label: 'Update', value: 'update', description: 'Enter a new value (stored securely)' },
              { label: 'Clear', value: 'clear', description: 'Remove the stored value' },
            ],
            {
              title: options.title,
              placeHolder: 'Choose an action',
              canPickMany: false,
            }
          );
          if (!action) return;

          if (action.value === 'clear') {
            const confirmed = await vscode.window.showWarningMessage(
              `Clear ${options.title}?`,
              { modal: true },
              'Clear'
            );
            if (confirmed !== 'Clear') return;

            await params.context.secrets.delete(options.storageKey);
            params.secrets.set(options.storageKey, undefined);
            vscode.window.showInformationMessage(options.clearedMessage);
            await syncSecretStatusIndicatorsBestEffort();
            return;
          }
        }

        const value = await vscode.window.showInputBox({
          title: options.title,
          password: true,
          prompt: options.prompt,
          placeHolder: options.placeHolder,
        });

        if (value === undefined) return;

        const trimmed = value.trim();
        if (!trimmed) return;

        await params.context.secrets.store(options.storageKey, trimmed);
        params.secrets.set(options.storageKey, trimmed);
        vscode.window.showInformationMessage(options.successMessage);
        await syncSecretStatusIndicatorsBestEffort();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`${options.errorPrefix}: ${message}`);
      }
    });

  const setApiKey = registerSecretCommand('openhands.setApiKey', {
    title: 'LLM API Key',
    secretKey: 'llmApiKey',
    prompt: 'Enter your LLM API key. It will be stored securely in VS Code SecretStorage.',
    placeHolder: 'sk-...',
    successMessage: 'LLM API Key saved securely.',
    clearedMessage: 'LLM API Key cleared.',
    errorPrefix: 'Failed to save API Key',
  });

  const setOpenAiApiKey = registerSecretStorageCommand('openhands.setOpenAiApiKey', {
    title: 'OpenAI API Key',
    storageKey: 'OPENAI_API_KEY',
    prompt: 'Enter your OpenAI API key. It will be stored securely in VS Code SecretStorage.',
    placeHolder: 'sk-...',
    successMessage: 'OpenAI API key saved securely.',
    clearedMessage: 'OpenAI API key cleared.',
    errorPrefix: 'Failed to save OpenAI API key',
  });

  const setAnthropicApiKey = registerSecretStorageCommand('openhands.setAnthropicApiKey', {
    title: 'Anthropic API Key',
    storageKey: 'ANTHROPIC_API_KEY',
    prompt: 'Enter your Anthropic API key. It will be stored securely in VS Code SecretStorage.',
    placeHolder: 'sk-ant-...',
    successMessage: 'Anthropic API key saved securely.',
    clearedMessage: 'Anthropic API key cleared.',
    errorPrefix: 'Failed to save Anthropic API key',
  });

  const setOpenRouterApiKey = registerSecretStorageCommand('openhands.setOpenRouterApiKey', {
    title: 'OpenRouter API Key',
    storageKey: 'OPENROUTER_API_KEY',
    prompt: 'Enter your OpenRouter API key. It will be stored securely in VS Code SecretStorage.',
    placeHolder: 'sk-or-...',
    successMessage: 'OpenRouter API key saved securely.',
    clearedMessage: 'OpenRouter API key cleared.',
    errorPrefix: 'Failed to save OpenRouter API key',
  });

  const setLiteLlmApiKey = registerSecretStorageCommand('openhands.setLiteLlmApiKey', {
    title: 'LiteLLM Proxy API Key',
    storageKey: 'LITELLM_API_KEY',
    prompt: 'Enter your LiteLLM Proxy API key. It will be stored securely in VS Code SecretStorage.',
    placeHolder: 'sk-...',
    successMessage: 'LiteLLM Proxy API key saved securely.',
    clearedMessage: 'LiteLLM Proxy API key cleared.',
    errorPrefix: 'Failed to save LiteLLM Proxy API key',
  });

  const setGeminiLlmApiKey = registerSecretStorageCommand('openhands.setGeminiLlmApiKey', {
    title: 'Gemini API Key',
    storageKey: 'GEMINI_API_KEY',
    prompt: 'Enter your Gemini API key. It will be stored securely in VS Code SecretStorage.',
    placeHolder: 'AIza...',
    successMessage: 'Gemini API key saved securely.',
    clearedMessage: 'Gemini API key cleared.',
    errorPrefix: 'Failed to save Gemini API key',
  });

  const setSessionApiKey = registerSecretCommand('openhands.setSessionApiKey', {
    title: 'Session API Key',
    secretKey: 'sessionApiKey',
    prompt: 'Enter your Session API key. It will be stored securely in VS Code SecretStorage.',
    successMessage: 'Session API Key saved securely.',
    clearedMessage: 'Session API Key cleared.',
    errorPrefix: 'Failed to save Session API Key',
  });

  const setGithubToken = registerSecretCommand('openhands.setGithubToken', {
    title: 'GitHub Token',
    secretKey: 'githubToken',
    prompt: 'Enter your GitHub token. It will be stored securely in VS Code SecretStorage.',
    placeHolder: 'ghp_...',
    successMessage: 'GitHub token saved securely.',
    clearedMessage: 'GitHub token cleared.',
    errorPrefix: 'Failed to save GitHub token',
  });

  const setElevenLabsApiKey = registerSecretCommand('openhands.setElevenLabsApiKey', {
    title: 'ElevenLabs API Key',
    secretKey: 'elevenLabsApiKey',
    prompt: 'Enter your ElevenLabs API key. It will be stored securely in VS Code SecretStorage.',
    placeHolder: 'xi-...',
    successMessage: 'ElevenLabs API key saved securely.',
    clearedMessage: 'ElevenLabs API key cleared.',
    errorPrefix: 'Failed to save ElevenLabs API key',
  });

  const setCustomSecret1 = registerSecretCommand('openhands.setCustomSecret1', {
    title: 'Custom Secret 1',
    secretKey: 'customSecret1',
    prompt: 'Enter a secret value. It will be stored securely in VS Code SecretStorage.',
    successMessage: 'Custom secret 1 saved securely.',
    clearedMessage: 'Custom secret 1 cleared.',
    errorPrefix: 'Failed to save custom secret 1',
  });

  const setCustomSecret2 = registerSecretCommand('openhands.setCustomSecret2', {
    title: 'Custom Secret 2',
    secretKey: 'customSecret2',
    prompt: 'Enter a secret value. It will be stored securely in VS Code SecretStorage.',
    successMessage: 'Custom secret 2 saved securely.',
    clearedMessage: 'Custom secret 2 cleared.',
    errorPrefix: 'Failed to save custom secret 2',
  });

  const setCustomSecret3 = registerSecretCommand('openhands.setCustomSecret3', {
    title: 'Custom Secret 3',
    secretKey: 'customSecret3',
    prompt: 'Enter a secret value. It will be stored securely in VS Code SecretStorage.',
    successMessage: 'Custom secret 3 saved securely.',
    clearedMessage: 'Custom secret 3 cleared.',
    errorPrefix: 'Failed to save custom secret 3',
  });

  void syncSecretStatusIndicatorsBestEffort();

  return [
    setApiKey,
    setOpenAiApiKey,
    setAnthropicApiKey,
    setOpenRouterApiKey,
    setLiteLlmApiKey,
    setGeminiLlmApiKey,
    setSessionApiKey,
    setGithubToken,
    setElevenLabsApiKey,
    setCustomSecret1,
    setCustomSecret2,
    setCustomSecret3,
  ];
}
