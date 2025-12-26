import type { LLMConfiguration } from '@openhands/agent-sdk-ts';

export type ProfileFormMode = 'create' | 'edit';

export type ProfileFormState = {
  name: string;
  provider: '' | 'openai' | 'anthropic' | 'openrouter' | 'litellm_proxy' | 'gemini';
  model: string;
  baseUrl: string;
  apiVersion: string;
  openaiApiMode: 'auto' | 'chat_completions' | 'responses';
  timeoutSeconds: string;
  temperature: string;
  topP: string;
  topK: string;
  maxInputTokens: string;
  maxOutputTokens: string;
  reasoningEffort: '' | 'none' | 'low' | 'medium' | 'high';
  reasoningSummary: '' | 'auto' | 'concise' | 'detailed';
  inputCostPerToken: string;
  outputCostPerToken: string;
};

export type FieldErrors = Partial<Record<keyof ProfileFormState, string>>;

export const EMPTY_FORM: ProfileFormState = {
  name: '',
  provider: '',
  model: '',
  baseUrl: '',
  apiVersion: '',
  openaiApiMode: 'auto',
  timeoutSeconds: '',
  temperature: '',
  topP: '',
  topK: '',
  maxInputTokens: '',
  maxOutputTokens: '',
  reasoningEffort: '',
  reasoningSummary: '',
  inputCostPerToken: '',
  outputCostPerToken: '',
};

export const ADVANCED_FIELD_KEYS: Array<keyof ProfileFormState> = [
  'apiVersion',
  'temperature',
  'topP',
  'topK',
  'maxInputTokens',
  'maxOutputTokens',
  'reasoningEffort',
  'reasoningSummary',
  'inputCostPerToken',
  'outputCostPerToken',
];

export type Provider = Exclude<ProfileFormState['provider'], ''>;

export const profileFieldId = (key: string) => `llmProfilesField-${key}`;

export const PROVIDER_DOCS_URLS: Record<Provider, string> = {
  openai: 'https://platform.openai.com/docs',
  anthropic: 'https://docs.anthropic.com/en/docs',
  openrouter: 'https://openrouter.ai/docs',
  litellm_proxy: 'https://docs.litellm.ai/docs',
  gemini: 'https://ai.google.dev/gemini-api/docs',
};

export const PROVIDER_LABELS: Record<Provider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  litellm_proxy: 'LiteLLM',
  gemini: 'Gemini',
};

export const PROVIDER_API_KEY_URLS: Partial<Record<Provider, string>> = {
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  openrouter: 'https://openrouter.ai/keys',
  litellm_proxy: 'https://docs.litellm.ai/docs/proxy/virtual_keys',
  gemini: 'https://aistudio.google.com/app/apikey',
};

export const MIN_OUTPUT_TOKENS = 1;
export const MAX_OUTPUT_TOKENS_SLIDER_MAX = 65536;
export const MAX_OUTPUT_TOKENS_SLIDER_STEP = 256;

export const toFormState = (profileId: string, config: LLMConfiguration): ProfileFormState => {
  const strOrEmpty = (v: unknown): string => (typeof v === 'string' ? v : '');
  const numOrEmpty = (v: unknown): string => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
  const nullableStr = (v: unknown): string => (typeof v === 'string' ? v : '');
  const nullableNum = (v: unknown): string => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
  const provider = config.provider;
  const openaiApiMode = provider === 'openai' && config.openaiApiMode
    ? config.openaiApiMode
    : 'auto';

  return {
    ...EMPTY_FORM,
    name: profileId,
    provider: provider === 'openai' || provider === 'anthropic' || provider === 'openrouter' || provider === 'litellm_proxy' || provider === 'gemini'
      ? provider
      : '',
    model: strOrEmpty(config.model),
    baseUrl: nullableStr(config.baseUrl),
    apiVersion: nullableStr(config.apiVersion),
    openaiApiMode,
    timeoutSeconds: nullableNum(config.timeoutSeconds),
    temperature: nullableNum(config.temperature),
    topP: nullableNum(config.topP),
    topK: nullableNum(config.topK),
    maxInputTokens: nullableNum(config.maxInputTokens),
    maxOutputTokens: nullableNum(config.maxOutputTokens),
    reasoningEffort: config.reasoningEffort === null || config.reasoningEffort === undefined
      ? ''
      : (config.reasoningEffort === 'none' || config.reasoningEffort === 'low' || config.reasoningEffort === 'medium' || config.reasoningEffort === 'high')
        ? config.reasoningEffort
        : '',
    reasoningSummary: config.reasoningSummary === null || config.reasoningSummary === undefined
      ? ''
      : (config.reasoningSummary === 'auto' || config.reasoningSummary === 'concise' || config.reasoningSummary === 'detailed')
        ? config.reasoningSummary
        : '',
    inputCostPerToken: numOrEmpty(config.inputCostPerToken),
    outputCostPerToken: numOrEmpty(config.outputCostPerToken),
  };
};

const validateProfileId = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return 'Name is required';
  if (trimmed !== value) return 'Name must not have leading/trailing whitespace';
  if (trimmed.includes('/') || trimmed.includes('\\')) return 'Name must not contain path separators';
  if (/\s/.test(trimmed)) return 'Name must not contain spaces';
  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) return 'Name contains invalid characters';
  return null;
};

export const parseOptionalNumber = (raw: string): { value: number | null; error?: string } => {
  const trimmed = raw.trim();
  if (!trimmed) return { value: null };
  const num = Number(trimmed);
  if (!Number.isFinite(num)) return { value: null, error: 'Must be a valid number' };
  if (num < 0) return { value: null, error: 'Must be >= 0' };
  return { value: num };
};

export const parseOptionalInt = (raw: string): { value: number | null; error?: string } => {
  const base = parseOptionalNumber(raw);
  if (base.error || base.value === null) return base;
  if (!Number.isInteger(base.value)) return { value: null, error: 'Must be an integer' };
  return base;
};

export const validateForm = (_mode: ProfileFormMode, form: ProfileFormState): FieldErrors => {
  const errors: FieldErrors = {};

  const nameErr = validateProfileId(form.name);
  if (nameErr) errors.name = nameErr;

  const model = form.model.trim();
  if (!model) errors.model = 'Model is required';

  if (form.baseUrl.trim()) {
    try {
      const url = new URL(form.baseUrl.trim());
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        errors.baseUrl = 'Base URL must start with http:// or https://';
      }
    } catch {
      errors.baseUrl = 'Base URL must be a valid URL';
    }
  }

  if (form.provider !== 'openai' && form.openaiApiMode !== 'auto') {
    errors.openaiApiMode = 'OpenAI API mode only applies to the OpenAI provider';
  }

  const timeout = parseOptionalNumber(form.timeoutSeconds);
  if (timeout.error) errors.timeoutSeconds = timeout.error;

  const temperature = parseOptionalNumber(form.temperature);
  if (temperature.error) errors.temperature = temperature.error;

  const topP = parseOptionalNumber(form.topP);
  if (topP.error) errors.topP = topP.error;

  const topK = parseOptionalInt(form.topK);
  if (topK.error) errors.topK = topK.error;

  const maxInputTokens = parseOptionalInt(form.maxInputTokens);
  if (maxInputTokens.error) errors.maxInputTokens = maxInputTokens.error;

  const maxOutputTokens = parseOptionalInt(form.maxOutputTokens);
  if (maxOutputTokens.error) {
    errors.maxOutputTokens = maxOutputTokens.error;
  } else if (maxOutputTokens.value !== null) {
    if (maxOutputTokens.value < MIN_OUTPUT_TOKENS) {
      errors.maxOutputTokens = `Must be >= ${MIN_OUTPUT_TOKENS}`;
    } else if (maxOutputTokens.value > MAX_OUTPUT_TOKENS_SLIDER_MAX) {
      errors.maxOutputTokens = `Must be <= ${MAX_OUTPUT_TOKENS_SLIDER_MAX}`;
    }
  }

  const inputCost = parseOptionalNumber(form.inputCostPerToken);
  if (inputCost.error) errors.inputCostPerToken = inputCost.error;

  const outputCost = parseOptionalNumber(form.outputCostPerToken);
  if (outputCost.error) errors.outputCostPerToken = outputCost.error;

  return errors;
};

export const buildProfileConfig = (form: ProfileFormState): LLMConfiguration => {
  const optionalStringOrNull = (raw: string): string | null => {
    const trimmed = raw.trim();
    return trimmed ? trimmed : null;
  };

  const timeoutSeconds = parseOptionalNumber(form.timeoutSeconds).value;
  const temperature = parseOptionalNumber(form.temperature).value;
  const topP = parseOptionalNumber(form.topP).value;
  const topK = parseOptionalInt(form.topK).value;
  const maxInputTokens = parseOptionalInt(form.maxInputTokens).value;
  const maxOutputTokens = parseOptionalInt(form.maxOutputTokens).value;
  const inputCostPerToken = parseOptionalNumber(form.inputCostPerToken).value;
  const outputCostPerToken = parseOptionalNumber(form.outputCostPerToken).value;

  const provider = form.provider || undefined;
  const openaiApiMode = provider === 'openai'
    ? (form.openaiApiMode === 'auto' ? null : form.openaiApiMode)
    : null;

  return {
    provider,
    model: form.model.trim(),
    baseUrl: optionalStringOrNull(form.baseUrl),
    apiVersion: optionalStringOrNull(form.apiVersion),
    openaiApiMode,
    timeoutSeconds,
    temperature,
    topP,
    topK,
    maxInputTokens,
    maxOutputTokens,
    reasoningEffort: form.reasoningEffort ? form.reasoningEffort : null,
    reasoningSummary: form.reasoningSummary ? form.reasoningSummary : null,
    inputCostPerToken,
    outputCostPerToken,
  };
};

