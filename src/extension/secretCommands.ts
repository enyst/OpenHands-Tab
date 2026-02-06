import * as vscode from 'vscode';
import { SettingsManager, type OpenHandsSettings } from '../settings/SettingsManager';
import { VscodeSettingsAdapter } from '../settings/VscodeSettingsAdapter';
import type { ConversationInstance, SecretRegistry } from '@openhands/agent-sdk-ts';
import { getServerCloudApiKeySecretKey } from '../auth/serverCloudApiKeys';
import { getServerRuntimeSessionApiKeySecretKey } from '../auth/serverRuntimeSessionApiKeys';
import { isOpenHandsCloudServerUrl } from '../shared/cloudServers';

type SecretKey = keyof OpenHandsSettings['secrets'];
type PerServerSecretKeyResult =
  | { ok: true; normalizedServerUrl: string; secretKey: string }
  | { ok: false; error: string };

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

  const updateConversationSettingsBestEffort = async (patch: Partial<OpenHandsSettings['secrets']>): Promise<void> => {
    try {
      const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(params.context));
      const updated = await settingsMgr.get();
      params.getConversation()?.setSettings({ ...updated, secrets: { ...updated.secrets, ...patch } });
    } catch {
      // Best-effort only.
    }
  };

  type SecretAction = 'update' | 'clear';
  type SecretCommandUiSpec = {
    commandId: string;
    title: string;
    prompt: string;
    placeHolder?: string;
    successMessage: string;
    clearedMessage: string;
    errorPrefix: string;
  };
  type SecretCommandPlan = {
    isCurrentlySet: boolean;
    clearConfirmationMessage: string;
    clearSecret: () => Promise<void>;
    setSecret: (value: string) => Promise<void>;
  };
  type SecretCommandSpec =
    | (SecretCommandUiSpec & {
      kind: 'settings';
      secretKey: SecretKey;
    })
    | (SecretCommandUiSpec & {
      kind: 'storage';
      storageKey: string;
    })
    | (SecretCommandUiSpec & {
      kind: 'perServer';
      settingsKey: SecretKey;
      missingServerMessage: string;
      invalidServerMessage?: string;
      getSecretKey: (serverUrl: string) => PerServerSecretKeyResult;
    });

  const promptSecretAction = async (title: string): Promise<SecretAction | undefined> => {
    const action = await vscode.window.showQuickPick(
      [
        { label: 'Update', value: 'update', description: 'Enter a new value (stored securely)' },
        { label: 'Clear', value: 'clear', description: 'Remove the stored value' },
      ],
      { title, placeHolder: 'Choose an action', canPickMany: false }
    );
    return action?.value as SecretAction | undefined;
  };

  const runSecretCommandFlow = async (
    spec: SecretCommandUiSpec,
    buildPlan: () => Promise<SecretCommandPlan | undefined>
  ): Promise<void> => {
    try {
      const plan = await buildPlan();
      if (!plan) return;

      if (plan.isCurrentlySet) {
        const action = await promptSecretAction(spec.title);
        if (!action) return;
        if (action === 'clear') {
          const confirmed = await vscode.window.showWarningMessage(
            plan.clearConfirmationMessage,
            { modal: true },
            'Clear'
          );
          if (confirmed !== 'Clear') return;
          await plan.clearSecret();
          vscode.window.showInformationMessage(spec.clearedMessage);
          await syncSecretStatusIndicatorsBestEffort();
          return;
        }
      }

      const value = await vscode.window.showInputBox({
        title: spec.title,
        password: true,
        prompt: spec.prompt,
        placeHolder: spec.placeHolder,
      });
      if (value === undefined) return;
      const trimmed = value.trim();
      if (!trimmed) return;

      await plan.setSecret(trimmed);
      vscode.window.showInformationMessage(spec.successMessage);
      await syncSecretStatusIndicatorsBestEffort();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`${spec.errorPrefix}: ${message}`);
    }
  };

  const commandSpecs: SecretCommandSpec[] = [
    {
      kind: 'settings',
      commandId: 'openhands.setApiKey',
      title: 'LLM API Key',
      secretKey: 'llmApiKey',
      prompt: 'Enter your LLM API key. It will be stored securely in VS Code SecretStorage.',
      placeHolder: 'sk-...',
      successMessage: 'LLM API Key saved securely.',
      clearedMessage: 'LLM API Key cleared.',
      errorPrefix: 'Failed to save API Key',
    },
    {
      kind: 'storage',
      commandId: 'openhands.setOpenAiApiKey',
      title: 'OpenAI API Key',
      storageKey: 'OPENAI_API_KEY',
      prompt: 'Enter your OpenAI API key. It will be stored securely in VS Code SecretStorage.',
      placeHolder: 'sk-...',
      successMessage: 'OpenAI API key saved securely.',
      clearedMessage: 'OpenAI API key cleared.',
      errorPrefix: 'Failed to save OpenAI API key',
    },
    {
      kind: 'storage',
      commandId: 'openhands.setAnthropicApiKey',
      title: 'Anthropic API Key',
      storageKey: 'ANTHROPIC_API_KEY',
      prompt: 'Enter your Anthropic API key. It will be stored securely in VS Code SecretStorage.',
      placeHolder: 'sk-ant-...',
      successMessage: 'Anthropic API key saved securely.',
      clearedMessage: 'Anthropic API key cleared.',
      errorPrefix: 'Failed to save Anthropic API key',
    },
    {
      kind: 'storage',
      commandId: 'openhands.setOpenRouterApiKey',
      title: 'OpenRouter API Key',
      storageKey: 'OPENROUTER_API_KEY',
      prompt: 'Enter your OpenRouter API key. It will be stored securely in VS Code SecretStorage.',
      placeHolder: 'sk-or-...',
      successMessage: 'OpenRouter API key saved securely.',
      clearedMessage: 'OpenRouter API key cleared.',
      errorPrefix: 'Failed to save OpenRouter API key',
    },
    {
      kind: 'storage',
      commandId: 'openhands.setLiteLlmApiKey',
      title: 'LiteLLM Proxy API Key',
      storageKey: 'LITELLM_API_KEY',
      prompt: 'Enter your LiteLLM Proxy API key. It will be stored securely in VS Code SecretStorage.',
      placeHolder: 'sk-...',
      successMessage: 'LiteLLM Proxy API key saved securely.',
      clearedMessage: 'LiteLLM Proxy API key cleared.',
      errorPrefix: 'Failed to save LiteLLM Proxy API key',
    },
    {
      kind: 'storage',
      commandId: 'openhands.setGeminiLlmApiKey',
      title: 'Gemini API Key',
      storageKey: 'GEMINI_API_KEY',
      prompt: 'Enter your Gemini API key. It will be stored securely in VS Code SecretStorage.',
      placeHolder: 'AIza...',
      successMessage: 'Gemini API key saved securely.',
      clearedMessage: 'Gemini API key cleared.',
      errorPrefix: 'Failed to save Gemini API key',
    },
    {
      kind: 'perServer',
      commandId: 'openhands.setCloudApiKey',
      title: 'Cloud API Key',
      settingsKey: 'cloudApiKey',
      prompt: 'Enter your OpenHands Cloud API key. It will be stored securely in VS Code SecretStorage.',
      placeHolder: 'paste token...',
      missingServerMessage: 'OpenHands: Select a remote server before setting a Cloud API Key.',
      invalidServerMessage: 'OpenHands: Cloud API Key is only used for OpenHands Cloud/SaaS servers.',
      getSecretKey: getServerCloudApiKeySecretKey,
      successMessage: 'Cloud API Key saved securely.',
      clearedMessage: 'Cloud API Key cleared.',
      errorPrefix: 'Failed to save Cloud API Key',
    },
    {
      kind: 'perServer',
      commandId: 'openhands.setRuntimeSessionApiKey',
      title: 'Runtime Session API Key',
      settingsKey: 'runtimeSessionApiKey',
      prompt: 'Enter the runtime session API key (`session_api_key`) for the remote agent-server. It will be stored securely in VS Code SecretStorage.',
      placeHolder: 'sk-...',
      missingServerMessage: 'OpenHands: Select a remote server before setting a Runtime Session API Key.',
      getSecretKey: getServerRuntimeSessionApiKeySecretKey,
      successMessage: 'Runtime Session API Key saved securely.',
      clearedMessage: 'Runtime Session API Key cleared.',
      errorPrefix: 'Failed to save Runtime Session API Key',
    },
    {
      kind: 'settings',
      commandId: 'openhands.setGithubToken',
      title: 'GitHub Token',
      secretKey: 'githubToken',
      prompt: 'Enter your GitHub token. It will be stored securely in VS Code SecretStorage.',
      placeHolder: 'ghp_...',
      successMessage: 'GitHub token saved securely.',
      clearedMessage: 'GitHub token cleared.',
      errorPrefix: 'Failed to save GitHub token',
    },
    {
      kind: 'settings',
      commandId: 'openhands.setHalTtsApiKey',
      title: 'HAL TTS API Key',
      secretKey: 'halTtsApiKey',
      prompt: 'Enter your HAL TTS API key. It will be stored securely in VS Code SecretStorage (currently used for the ElevenLabs backend).',
      placeHolder: 'xi-...',
      successMessage: 'HAL TTS API key saved securely.',
      clearedMessage: 'HAL TTS API key cleared.',
      errorPrefix: 'Failed to save HAL TTS API key',
    },
    {
      kind: 'settings',
      commandId: 'openhands.setCustomSecret1',
      title: 'Custom Secret 1',
      secretKey: 'customSecret1',
      prompt: 'Enter a secret value. It will be stored securely in VS Code SecretStorage.',
      successMessage: 'Custom secret 1 saved securely.',
      clearedMessage: 'Custom secret 1 cleared.',
      errorPrefix: 'Failed to save custom secret 1',
    },
    {
      kind: 'settings',
      commandId: 'openhands.setCustomSecret2',
      title: 'Custom Secret 2',
      secretKey: 'customSecret2',
      prompt: 'Enter a secret value. It will be stored securely in VS Code SecretStorage.',
      successMessage: 'Custom secret 2 saved securely.',
      clearedMessage: 'Custom secret 2 cleared.',
      errorPrefix: 'Failed to save custom secret 2',
    },
    {
      kind: 'settings',
      commandId: 'openhands.setCustomSecret3',
      title: 'Custom Secret 3',
      secretKey: 'customSecret3',
      prompt: 'Enter a secret value. It will be stored securely in VS Code SecretStorage.',
      successMessage: 'Custom secret 3 saved securely.',
      clearedMessage: 'Custom secret 3 cleared.',
      errorPrefix: 'Failed to save custom secret 3',
    },
  ];

  const registerSecretCommand = (spec: SecretCommandSpec): vscode.Disposable =>
    vscode.commands.registerCommand(spec.commandId, async () => {
      switch (spec.kind) {
        case 'settings':
          await runSecretCommandFlow(spec, async () => {
            const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(params.context));
            const existing = await settingsMgr.get();
            const currentValue = existing.secrets[spec.secretKey];
            const updateAndSync = async (value: string | undefined): Promise<void> => {
              const secretsUpdate = { [spec.secretKey]: value } as Partial<OpenHandsSettings['secrets']>;
              await settingsMgr.update({ secrets: secretsUpdate });
              const newSettings = await settingsMgr.get();
              params.getConversation()?.setSettings(newSettings);
            };
            return {
              isCurrentlySet: typeof currentValue === 'string' && currentValue.trim().length > 0,
              clearConfirmationMessage: `Clear ${spec.title}?`,
              clearSecret: async () => updateAndSync(undefined),
              setSecret: async (value: string) => updateAndSync(value),
            };
          });
          return;
        case 'storage':
          await runSecretCommandFlow(spec, async () => {
            const currentValue = await params.context.secrets.get(spec.storageKey);
            return {
              isCurrentlySet: typeof currentValue === 'string' && currentValue.trim().length > 0,
              clearConfirmationMessage: `Clear ${spec.title}?`,
              clearSecret: async () => {
                await params.context.secrets.delete(spec.storageKey);
                params.secrets.set(spec.storageKey, undefined);
              },
              setSecret: async (value: string) => {
                await params.context.secrets.store(spec.storageKey, value);
                params.secrets.set(spec.storageKey, value);
              },
            };
          });
          return;
        case 'perServer':
          await runSecretCommandFlow(spec, async () => {
            const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(params.context));
            const existing = await settingsMgr.get();
            const serverUrl = typeof existing.serverUrl === 'string' ? existing.serverUrl.trim() : '';
            if (!serverUrl) {
              void vscode.window.showErrorMessage(spec.missingServerMessage);
              return undefined;
            }
            if (spec.invalidServerMessage && !isOpenHandsCloudServerUrl(serverUrl)) {
              void vscode.window.showErrorMessage(spec.invalidServerMessage);
              return undefined;
            }

            const keyInfo = spec.getSecretKey(serverUrl);
            if (!keyInfo.ok) {
              void vscode.window.showErrorMessage(`OpenHands: Invalid server URL: ${keyInfo.error}`);
              return undefined;
            }

            let currentValue: string | undefined;
            try {
              currentValue = await params.context.secrets.get(keyInfo.secretKey);
            } catch {
              currentValue = undefined;
            }

            return {
              isCurrentlySet: typeof currentValue === 'string' && currentValue.trim().length > 0,
              clearConfirmationMessage: `Clear ${spec.title} for ${keyInfo.normalizedServerUrl}?`,
              clearSecret: async () => {
                await params.context.secrets.delete(keyInfo.secretKey);
                params.secrets.set(keyInfo.secretKey, undefined);
                await updateConversationSettingsBestEffort({ [spec.settingsKey]: undefined } as Partial<OpenHandsSettings['secrets']>);
              },
              setSecret: async (value: string) => {
                await params.context.secrets.store(keyInfo.secretKey, value);
                params.secrets.set(keyInfo.secretKey, value);
                await updateConversationSettingsBestEffort({ [spec.settingsKey]: value } as Partial<OpenHandsSettings['secrets']>);
              },
            };
          });
          return;
      }
    });

  void syncSecretStatusIndicatorsBestEffort();

  return commandSpecs.map(registerSecretCommand);
}
