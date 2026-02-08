import type { LLMProvider, OpenAIChatApi, ReasoningSummary } from '../llm/types';

export type LLMSettings = {
  /**
   * Optional LLM profile identifier (filename stem under the profile store).
   * When set, the effective provider/model/baseUrl/etc are resolved from the profile store.
   */
  profileId?: string | null;
  provider?: LLMProvider | null;
  model?: string | null;
  /** OpenAI-specific API selection (local-mode only). */
  openaiApiMode?: OpenAIChatApi | null;
  baseUrl?: string | null;
  apiVersion?: string | null;
  timeout?: number | null;
  temperature?: number | null;
  topP?: number | null;
  topK?: number | null;
  maxInputTokens?: number | null;
  maxOutputTokens?: number | null;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'none' | null;
  /** OpenAI Responses-only; ignored by Chat Completions. */
  reasoningSummary?: ReasoningSummary | null;
  inputCostPerToken?: number | null;
  outputCostPerToken?: number | null;
  encrypted_reasoning?: string | null;
};

export const RAW_LLM_FIELDS_IGNORED_WHEN_PROFILE_SELECTED = [
  'provider',
  'model',
  'openaiApiMode',
  'baseUrl',
  'apiVersion',
  'timeout',
  'temperature',
  'topP',
  'topK',
  'maxInputTokens',
  'maxOutputTokens',
  'reasoningEffort',
  'reasoningSummary',
  'inputCostPerToken',
  'outputCostPerToken',
] as const;

export type RawLlmFieldIgnoredWhenProfileSelected = (typeof RAW_LLM_FIELDS_IGNORED_WHEN_PROFILE_SELECTED)[number];

export const clearRawLlmFieldsWhenProfileSelected = (llm: LLMSettings): LLMSettings => {
  const profileId = typeof llm.profileId === 'string' ? llm.profileId.trim() : '';
  if (!profileId) return llm;
  return {
    ...llm,
    provider: undefined,
    model: undefined,
    openaiApiMode: undefined,
    baseUrl: undefined,
    apiVersion: undefined,
    timeout: undefined,
    temperature: undefined,
    topP: undefined,
    topK: undefined,
    maxInputTokens: undefined,
    maxOutputTokens: undefined,
    reasoningEffort: undefined,
    reasoningSummary: undefined,
    inputCostPerToken: undefined,
    outputCostPerToken: undefined,
  };
};

export type ServerSettings = {
  serverUrl?: string | null;
};

export type AgentSettings = {
  enableSecurityAnalyzer?: boolean;
  debug?: boolean;
  /**
   * When enabled, generates short summaries of tool executions (using the `gemini-flash-summarizer` LLM profile)
   * and injects them into the next agent LLM request as additional context.
   */
  summarizeToolCalls?: boolean;
};

export type StuckDetectionThresholds = {
  actionObservation?: number;
  actionError?: number;
  monologue?: number;
  alternatingPattern?: number;
};

export type ConversationSettings = {
  maxIterations?: number;
  stuckDetection?: boolean;
  stuckThresholds?: StuckDetectionThresholds;
};

export type ConfirmationSettings = {
  policy?: 'never' | 'always' | 'risky';
  riskyThreshold?: 'LOW' | 'MEDIUM' | 'HIGH';
  confirmUnknown?: boolean;
};

export type OracleSettings = {
  /**
   * LLM profile identifier (filename stem) used for the ask_oracle tool.
   * When unset, ask_oracle returns an instructive error prompting configuration.
   */
  profileId?: string | null;
};

export type OpenHandsSettings = ServerSettings & {
  llm: LLMSettings;
  oracle?: OracleSettings;
  agent: AgentSettings;
  conversation: ConversationSettings;
  confirmation: ConfirmationSettings;
  secrets: {
    /**
     * Remote-mode credentials are injected by the host application at runtime.
     *
     * In OpenHands-Tab, these values come from per-server VS Code SecretStorage slots.
     */
    cloudApiKey?: string;
    runtimeSessionApiKey?: string;
    llmApiKey?: string;
    awsAccessKeyId?: string;
    awsSecretAccessKey?: string;
    githubToken?: string;
    halTtsApiKey?: string;
    customSecret1?: string;
    customSecret2?: string;
    customSecret3?: string;
  };
};
