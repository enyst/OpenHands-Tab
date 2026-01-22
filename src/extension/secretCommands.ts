import * as vscode from 'vscode';
import { SettingsManager, type OpenHandsSettings } from '../settings/SettingsManager';
import { VscodeSettingsAdapter } from '../settings/VscodeSettingsAdapter';
import type { ConversationInstance, SecretRegistry } from '@openhands/agent-sdk-ts';
import { getServerCloudApiKeySecretKey } from '../auth/serverCloudApiKeys';
import { getServerRuntimeSessionApiKeySecretKey } from '../auth/serverRuntimeSessionApiKeys';
import { isOpenHandsCloudServerUrl } from '../shared/cloudServers';

type SecretKey = keyof OpenHandsSettings['secrets'];

const SECRET_STATUS_SET_VALUE = '✓ set';

async function syncSecretStatusIndicators(params: { context: vscode.ExtensionContext }): Promise<void> {
  const cfg = vscode.workspace.getConfiguration();

  const getIsSetFromSecretStorage = async (storageKey: string): Promise<boolean> => {
    const value = await params.context.secrets.get(storageKey);
    return typeof value === 'string' && value.trim().length > 0;
  };

  let settings: OpenHandsSettings | undefined;
  try {
    const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(params.context));
    settings = await settingsMgr.get();
  } catch {
    // Best-effort: do not surface errors for a purely UX indicator.
    settings = undefined;
  }

  const getIsSetFromSettingsSecrets = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0;

  const serverUrl = typeof settings?.serverUrl === 'string' ? settings.serverUrl.trim() : '';
  const isCloud = Boolean(serverUrl) && isOpenHandsCloudServerUrl(serverUrl);
  const isCloudApiKeySet = await (async (): Promise<boolean> => {
    if (!serverUrl || !isCloud) return false;
    const keyInfo = getServerCloudApiKeySecretKey(serverUrl);
    if (!keyInfo.ok) return false;
    return await getIsSetFromSecretStorage(keyInfo.secretKey);
  })();
  const isRuntimeSessionApiKeySet = await (async (): Promise<boolean> => {
    if (!serverUrl) return false;
    const keyInfo = getServerRuntimeSessionApiKeySecretKey(serverUrl);
    if (!keyInfo.ok) return false;
    return await getIsSetFromSecretStorage(keyInfo.secretKey);
  })();

  const indicators: Array<{ key: string; isSet: boolean }> = [
    { key: 'openhands.secrets.openaiApiKey', isSet: await getIsSetFromSecretStorage('OPENAI_API_KEY') },
    { key: 'openhands.secrets.anthropicApiKey', isSet: await getIsSetFromSecretStorage('ANTHROPIC_API_KEY') },
    { key: 'openhands.secrets.openrouterApiKey', isSet: await getIsSetFromSecretStorage('OPENROUTER_API_KEY') },
    { key: 'openhands.secrets.litellmApiKey', isSet: await getIsSetFromSecretStorage('LITELLM_API_KEY') },
    { key: 'openhands.secrets.geminiLlmApiKey', isSet: await getIsSetFromSecretStorage('GEMINI_API_KEY') },

    { key: 'openhands.secrets.cloudApiKey', isSet: isCloudApiKeySet },
    { key: 'openhands.secrets.runtimeSessionApiKey', isSet: isRuntimeSessionApiKeySet },
    { key: 'openhands.secrets.githubToken', isSet: getIsSetFromSettingsSecrets(settings?.secrets?.githubToken) },
    { key: 'openhands.hal.ttsApiKey', isSet: getIsSetFromSettingsSecrets(settings?.secrets?.halTtsApiKey) },
    { key: 'openhands.secrets.customSecret1', isSet: getIsSetFromSettingsSecrets(settings?.secrets?.customSecret1) },
    { key: 'openhands.secrets.customSecret2', isSet: getIsSetFromSettingsSecrets(settings?.secrets?.customSecret2) },
    { key: 'openhands.secrets.customSecret3', isSet: getIsSetFromSettingsSecrets(settings?.secrets?.customSecret3) },
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

  const updateConversationSettingsBestEffort = async (patch: Partial<OpenHandsSettings['secrets']>): Promise<void> => {
    try {
      const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(params.context));
      const updated = await settingsMgr.get();
      params.getConversation()?.setSettings({ ...updated, secrets: { ...updated.secrets, ...patch } });
    } catch {
      // Best-effort only.
    }
  };

  const setCloudApiKey = vscode.commands.registerCommand('openhands.setCloudApiKey', async () => {
    try {
      const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(params.context));
      const existing = await settingsMgr.get();
      const serverUrl = typeof existing.serverUrl === 'string' ? existing.serverUrl.trim() : '';
      if (!serverUrl) {
        void vscode.window.showErrorMessage('OpenHands: Select a remote server before setting a Cloud API Key.');
        return;
      }
      if (!isOpenHandsCloudServerUrl(serverUrl)) {
        void vscode.window.showErrorMessage('OpenHands: Cloud API Key is only used for OpenHands Cloud/SaaS servers.');
        return;
      }

      const keyInfo = getServerCloudApiKeySecretKey(serverUrl);
      if (!keyInfo.ok) {
        void vscode.window.showErrorMessage(`OpenHands: Invalid server URL: ${keyInfo.error}`);
        return;
      }

      const title = 'Cloud API Key';
      const prompt = 'Enter your OpenHands Cloud API key. It will be stored securely in VS Code SecretStorage.';

      let currentValue: string | undefined;
      try {
        currentValue = await params.context.secrets.get(keyInfo.secretKey);
      } catch {
        currentValue = undefined;
      }
      const isCurrentlySet = typeof currentValue === 'string' && currentValue.trim().length > 0;

      if (isCurrentlySet) {
        const action = await vscode.window.showQuickPick(
          [
            { label: 'Update', value: 'update', description: 'Enter a new value (stored securely)' },
            { label: 'Clear', value: 'clear', description: 'Remove the stored value' },
          ],
          { title, placeHolder: 'Choose an action', canPickMany: false }
        );
        if (!action) return;
        if (action.value === 'clear') {
          const confirmed = await vscode.window.showWarningMessage(
            `Clear ${title} for ${keyInfo.normalizedServerUrl}?`,
            { modal: true },
            'Clear'
          );
          if (confirmed !== 'Clear') return;
          await params.context.secrets.delete(keyInfo.secretKey);
          params.secrets.set(keyInfo.secretKey, undefined);
          await updateConversationSettingsBestEffort({ cloudApiKey: undefined });
          void vscode.window.showInformationMessage('Cloud API Key cleared.');
          await syncSecretStatusIndicatorsBestEffort();
          return;
        }
      }

      const value = await vscode.window.showInputBox({
        title,
        password: true,
        prompt,
        placeHolder: 'paste token...',
      });
      if (value === undefined) return;
      const trimmed = value.trim();
      if (!trimmed) return;

      await params.context.secrets.store(keyInfo.secretKey, trimmed);
      params.secrets.set(keyInfo.secretKey, trimmed);
      await updateConversationSettingsBestEffort({ cloudApiKey: trimmed });
      void vscode.window.showInformationMessage('Cloud API Key saved securely.');
      await syncSecretStatusIndicatorsBestEffort();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Failed to save Cloud API Key: ${message}`);
    }
  });

  const setRuntimeSessionApiKey = vscode.commands.registerCommand('openhands.setRuntimeSessionApiKey', async () => {
    try {
      const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(params.context));
      const existing = await settingsMgr.get();
      const serverUrl = typeof existing.serverUrl === 'string' ? existing.serverUrl.trim() : '';
      if (!serverUrl) {
        void vscode.window.showErrorMessage('OpenHands: Select a remote server before setting a Runtime Session API Key.');
        return;
      }

      const keyInfo = getServerRuntimeSessionApiKeySecretKey(serverUrl);
      if (!keyInfo.ok) {
        void vscode.window.showErrorMessage(`OpenHands: Invalid server URL: ${keyInfo.error}`);
        return;
      }

      const title = 'Runtime Session API Key';
      const prompt = 'Enter the runtime session API key (`session_api_key`) for the remote agent-server. It will be stored securely in VS Code SecretStorage.';

      let currentValue: string | undefined;
      try {
        currentValue = await params.context.secrets.get(keyInfo.secretKey);
      } catch {
        currentValue = undefined;
      }
      const isCurrentlySet = typeof currentValue === 'string' && currentValue.trim().length > 0;

      if (isCurrentlySet) {
        const action = await vscode.window.showQuickPick(
          [
            { label: 'Update', value: 'update', description: 'Enter a new value (stored securely)' },
            { label: 'Clear', value: 'clear', description: 'Remove the stored value' },
          ],
          { title, placeHolder: 'Choose an action', canPickMany: false }
        );
        if (!action) return;
        if (action.value === 'clear') {
          const confirmed = await vscode.window.showWarningMessage(
            `Clear ${title} for ${keyInfo.normalizedServerUrl}?`,
            { modal: true },
            'Clear'
          );
          if (confirmed !== 'Clear') return;
          await params.context.secrets.delete(keyInfo.secretKey);
          params.secrets.set(keyInfo.secretKey, undefined);
          await updateConversationSettingsBestEffort({ runtimeSessionApiKey: undefined });
          void vscode.window.showInformationMessage('Runtime Session API Key cleared.');
          await syncSecretStatusIndicatorsBestEffort();
          return;
        }
      }

      const value = await vscode.window.showInputBox({
        title,
        password: true,
        prompt,
        placeHolder: 'sk-...',
      });
      if (value === undefined) return;
      const trimmed = value.trim();
      if (!trimmed) return;

      await params.context.secrets.store(keyInfo.secretKey, trimmed);
      params.secrets.set(keyInfo.secretKey, trimmed);
      await updateConversationSettingsBestEffort({ runtimeSessionApiKey: trimmed });
      void vscode.window.showInformationMessage('Runtime Session API Key saved securely.');
      await syncSecretStatusIndicatorsBestEffort();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Failed to save Runtime Session API Key: ${message}`);
    }
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

  const setHalTtsApiKey = registerSecretCommand('openhands.setHalTtsApiKey', {
    title: 'HAL TTS API Key',
    secretKey: 'halTtsApiKey',
    prompt: 'Enter your HAL TTS API key. It will be stored securely in VS Code SecretStorage (currently used for the ElevenLabs backend).',
    placeHolder: 'xi-...',
    successMessage: 'HAL TTS API key saved securely.',
    clearedMessage: 'HAL TTS API key cleared.',
    errorPrefix: 'Failed to save HAL TTS API key',
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
    setCloudApiKey,
    setRuntimeSessionApiKey,
    setGithubToken,
    setHalTtsApiKey,
    setCustomSecret1,
    setCustomSecret2,
    setCustomSecret3,
  ];
}
