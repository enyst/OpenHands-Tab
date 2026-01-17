import * as path from 'path';
import * as os from 'os';
import type * as vscode from 'vscode';
import { assertValidProfileId, DEFAULT_PROVIDER_BASE_URLS, detectProviderFromBaseUrl, LLMProfileValidationError } from '@openhands/agent-sdk-ts';
import { ElevenLabsTtsService } from '../../../hal/elevenlabs/ttsService';
import { TtsConversationGate } from '../../../hal/elevenlabs/ttsConversationGate';
import { classifyHalVoiceDecision } from '../../../hal/gemini/decisionClassifier';
import { DEFAULT_HAL_LLM_PROFILE_ID } from '../../../shared/halDefaults';
import { getHalDialogueLinesForMode } from '../../../shared/halScript';
import type { SettingsManager } from '../../../settings/SettingsManager';
import type { WebviewToHostMessage } from '../../../shared/webviewMessages';
import type { CreateWebviewMessageHandlerDeps, WebviewHost } from '../createWebviewMessageHandler';
import * as llmProfilesStore from '../llmProfilesStore';
import { createStoredSecretHelpers, getProviderApiKeyName } from './secretHelpers';

const validateProfileId = (profileId: string): void => {
  try {
    assertValidProfileId(profileId);
  } catch (err) {
    if (err instanceof LLMProfileValidationError) {
      throw new Error(err.message);
    }
    throw err;
  }
};

const getProfileApiKeySecretKey = (profileId: string): string => {
  validateProfileId(profileId);
  return `openhands.llmProfileApiKey.${profileId}`;
};

const llmProfileStoreOptions = (deps: CreateWebviewMessageHandlerDeps): { rootDir?: string } => {
  const rootDir = typeof deps.getLlmProfilesStoreRoot === 'function' ? deps.getLlmProfilesStoreRoot() : undefined;
  if (typeof rootDir !== 'string') return {};
  const trimmed = rootDir.trim();
  return trimmed ? { rootDir: trimmed } : {};
};

export const createElevenlabsTtsGateFactory = (args: {
  context: vscode.ExtensionContext;
  maxCacheBytes: number;
}): (() => TtsConversationGate) => {
  let gate: TtsConversationGate | null = null;
  return () => {
    if (gate) return gate;
    const baseDir = args.context.globalStorageUri?.fsPath || path.join(os.tmpdir(), 'oh-tab-global-storage');
    const cacheDir = path.join(baseDir, 'hal', 'elevenlabs', 'tts-cache');
    gate = new TtsConversationGate(
      new ElevenLabsTtsService({
        cacheDir,
        maxCacheBytes: args.maxCacheBytes,
      })
    );
    return gate;
  };
};

export async function handleHalTtsRequest(args: {
  deps: CreateWebviewMessageHandlerDeps;
  host: WebviewHost;
  settingsMgr: Pick<SettingsManager, 'get'>;
  getElevenlabsTtsGate: () => TtsConversationGate;
  message: Extract<WebviewToHostMessage, { type: 'halTtsRequest' }>;
}): Promise<void> {
  if (typeof args.message.requestId !== 'string' || typeof args.message.conversationId !== 'string') return;
  if (typeof args.message.stepIndex !== 'number' || !Number.isFinite(args.message.stepIndex)) return;

  const stepIndex = Math.trunc(args.message.stepIndex);
  if (stepIndex < 0) return;

  const settings = await args.settingsMgr.get();
  const script = getHalDialogueLinesForMode(settings.hal.userName, settings.hal.mode);
  const line = script[stepIndex];
  if (!line) {
    void args.host.postMessage({ type: 'halTtsResponse', requestId: args.message.requestId, ok: false, error: 'Invalid HAL script line', shouldNotify: true });
    return;
  }

  const apiKey = settings.secrets.halTtsApiKey ?? '';
  const voiceId = line.voice === 'voice_hal' ? (settings.hal.voiceAId ?? '') : (settings.hal.voiceUserId ?? '');

  const result = await args.getElevenlabsTtsGate().synthesize({
    conversationId: args.message.conversationId,
    apiKey,
    voiceId,
    text: line.text,
    modelId: settings.hal.modelId,
    cacheEnabled: settings.hal.cache,
  });

  if (result.ok) {
    void args.host.postMessage({
      type: 'halTtsResponse',
      requestId: args.message.requestId,
      ok: true,
      audioBase64: Buffer.from(result.bytes).toString('base64'),
      volume: settings.hal.volume,
      mimeType: 'audio/mpeg',
    });
    return;
  }

  void args.host.postMessage({
    type: 'halTtsResponse',
    requestId: args.message.requestId,
    ok: false,
    error: result.error,
    shouldNotify: result.shouldNotify,
    disabled: result.disabled,
  });
}

export async function handleHalVoiceConfirmRequest(args: {
  deps: CreateWebviewMessageHandlerDeps;
  host: WebviewHost;
  context: vscode.ExtensionContext;
  settingsMgr: Pick<SettingsManager, 'get'>;
  outputChannel: vscode.OutputChannel | undefined;
  message: Extract<WebviewToHostMessage, { type: 'halVoiceConfirmRequest' }>;
}): Promise<void> {
  if (typeof args.message.requestId !== 'string') return;
  if (typeof args.message.mimeType !== 'string') return;
  if (typeof args.message.audioBase64 !== 'string' || args.message.audioBase64.length === 0) {
    void args.host.postMessage({ type: 'halVoiceConfirmResponse', requestId: args.message.requestId, ok: false, error: 'No audio provided' });
    return;
  }

  const settings = await args.settingsMgr.get();

  const defaultHalProfileId = DEFAULT_HAL_LLM_PROFILE_ID;
  const configuredHalProfileId = typeof settings.hal.llmProfileId === 'string'
    ? settings.hal.llmProfileId.trim()
    : '';
  const halProfileId = (() => {
    if (!configuredHalProfileId) return defaultHalProfileId;
    try {
      validateProfileId(configuredHalProfileId);
      return configuredHalProfileId;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      args.outputChannel?.appendLine(`[hal] Invalid HAL llmProfileId '${configuredHalProfileId}'; using '${defaultHalProfileId}': ${reason}`);
      return defaultHalProfileId;
    }
  })();

  let halProfile: ReturnType<typeof llmProfilesStore.loadProfile> | undefined;
  try {
    halProfile = llmProfilesStore.loadProfile(halProfileId, llmProfileStoreOptions(args.deps));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    void args.host.postMessage({ type: 'halVoiceConfirmResponse', requestId: args.message.requestId, ok: false, error: reason });
    args.outputChannel?.appendLine(`[hal] Failed to load HAL LLM profile '${halProfileId}': ${reason}`);
    return;
  }

  const model = typeof halProfile.config.model === 'string' ? halProfile.config.model.trim() : '';
  const baseUrlFromProfile = typeof halProfile.config.baseUrl === 'string' ? halProfile.config.baseUrl.trim() : '';
  const provider = halProfile.config.provider ?? detectProviderFromBaseUrl(baseUrlFromProfile);
  if (provider !== 'gemini') {
    const error = `HAL voice_confirm requires a Gemini profile (got provider '${provider}').`;
    void args.host.postMessage({ type: 'halVoiceConfirmResponse', requestId: args.message.requestId, ok: false, error });
    args.outputChannel?.appendLine(`[hal] ${error}`);
    return;
  }

  const baseUrl = baseUrlFromProfile || DEFAULT_PROVIDER_BASE_URLS.gemini;

  const { getStoredSecret } = createStoredSecretHelpers({ context: args.context, secretRegistry: args.deps.secretRegistry });

  const apiKeyRefName = halProfile.config.apiKeyRef?.kind === 'key' ? halProfile.config.apiKeyRef.name : undefined;

  const keyOrder = [
    ...(typeof apiKeyRefName === 'string' && apiKeyRefName.trim() ? [apiKeyRefName.trim()] : []),
    getProfileApiKeySecretKey(halProfileId),
    getProviderApiKeyName(provider),
    'openhands.llmApiKey',
    'LLM_API_KEY',
  ].filter((key, idx, arr) => arr.indexOf(key) === idx);
  let halGeminiKey: string | undefined;
  for (const key of keyOrder) {
    const candidate = await getStoredSecret(key);
    if (candidate) {
      halGeminiKey = candidate;
      break;
    }
  }

  const result = await classifyHalVoiceDecision({
    baseUrl,
    apiKey: halGeminiKey ?? '',
    model,
    mimeType: args.message.mimeType,
    audioBase64: args.message.audioBase64,
  });

  if (result.ok) {
    void args.host.postMessage({ type: 'halVoiceConfirmResponse', requestId: args.message.requestId, ok: true, decision: result.decision });
    return;
  }

  void args.host.postMessage({ type: 'halVoiceConfirmResponse', requestId: args.message.requestId, ok: false, error: result.error });
}
