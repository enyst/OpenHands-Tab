import type { OpenHandsSettings } from '../types/settings';
import { assertValidProfileId, loadProfile } from './profiles';

const toOptionalNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

const pickFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
};

const pickReasoningEffort = (value: unknown): 'low' | 'medium' | 'high' | 'none' | undefined => {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'none' ? value : undefined;
};

const pickReasoningSummary = (value: unknown): 'auto' | 'concise' | 'detailed' | undefined => {
  return value === 'auto' || value === 'concise' || value === 'detailed' ? value : undefined;
};

const pickEncryptedReasoningPreview = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= 8) return trimmed;
  return `${trimmed.slice(0, 4)}..${trimmed.slice(-4)}`;
};

const mergeGenerationParams = (
  source: { temperature?: unknown; maxOutputTokens?: unknown; reasoningEffort?: unknown; reasoningSummary?: unknown } | undefined,
  target: Record<string, unknown>,
) => {
  const temperature = pickFiniteNumber(source?.temperature);
  if (temperature !== undefined) target.temperature = temperature;

  const maxOutputTokens = pickFiniteNumber(source?.maxOutputTokens);
  if (maxOutputTokens !== undefined) target.maxOutputTokens = maxOutputTokens;

  const reasoningEffort = pickReasoningEffort(source?.reasoningEffort);
  if (reasoningEffort) target.reasoningEffort = reasoningEffort;

  const reasoningSummary = pickReasoningSummary(source?.reasoningSummary);
  if (reasoningSummary) target.reasoningSummary = reasoningSummary;
};

const mergeEncryptedReasoning = (source: unknown, target: Record<string, unknown>) => {
  const encryptedReasoning = typeof source === 'object' && source !== null
    ? (source as { encrypted_reasoning?: unknown }).encrypted_reasoning
    : undefined;
  const preview = pickEncryptedReasoningPreview(encryptedReasoning);
  if (preview) target.encrypted_reasoning = preview;
};

export const buildLlmRequestParametersForDebug = (params: {
  llmSettings?: OpenHandsSettings['llm'];
  model: string;
}): Record<string, unknown> | undefined => {
  const settings = params.llmSettings;
  const parameters: Record<string, unknown> = {};

  mergeGenerationParams(settings, parameters);
  mergeEncryptedReasoning(settings, parameters);

  const profileId = toOptionalNonEmptyString(settings?.profileId);
  if (profileId) {
    assertValidProfileId(profileId);
    const profile = loadProfile(profileId);
    mergeGenerationParams(profile.config, parameters);
    mergeEncryptedReasoning(profile.config, parameters);
  }

  const normalizedModel = params.model.trim().toLowerCase();
  if (normalizedModel.includes('gpt-5')) {
    delete parameters.temperature;
  }

  return Object.keys(parameters).length ? parameters : undefined;
};
