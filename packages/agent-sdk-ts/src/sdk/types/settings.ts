import type { LLMProvider } from '../llm/types';

export type LLMSettings = {
  usageId?: string | null;
  provider?: LLMProvider | null;
  model?: string | null;
  baseUrl?: string | null;
  apiVersion?: string | null;
  timeout?: number | null;
  temperature?: number | null;
  topP?: number | null;
  topK?: number | null;
  maxInputTokens?: number | null;
  maxOutputTokens?: number | null;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'none' | null;
  inputCostPerToken?: number | null;
  outputCostPerToken?: number | null;
};

export type ServerSettings = {
  serverUrl?: string | null;
};

export type AgentSettings = {
  enableSecurityAnalyzer?: boolean;
  debug?: boolean;
};

export type ConversationSettings = {
  maxIterations?: number;
};

export type ConfirmationSettings = {
  policy?: 'never' | 'always' | 'risky';
  riskyThreshold?: 'LOW' | 'MEDIUM' | 'HIGH';
  confirmUnknown?: boolean;
};

export type OpenHandsSettings = ServerSettings & {
  llm: LLMSettings;
  agent: AgentSettings;
  conversation: ConversationSettings;
  confirmation: ConfirmationSettings;
  secrets: {
    sessionApiKey?: string;
    llmApiKey?: string;
    awsAccessKeyId?: string;
    awsSecretAccessKey?: string;
    githubToken?: string;
    elevenLabsApiKey?: string;
    customSecret1?: string;
    customSecret2?: string;
    customSecret3?: string;
  };
};
