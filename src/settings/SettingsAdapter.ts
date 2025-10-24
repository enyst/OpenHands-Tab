export interface SettingsAdapter {
  // Config
  get<T = unknown>(key: string, defaultValue?: T): T | undefined;
  /**
   * Returns the explicitly configured value for a key, or undefined if the value
   * only comes from defaults (package.json) or is not set.
   */
  getExplicit<T = unknown>(key: string): T | undefined;
  update<T = unknown>(key: string, value: T, target?: 'workspace' | 'global'): Promise<void>;

  // Secrets
  getSecret(key: string): Promise<string | undefined>;
  storeSecret(key: string, value: string | undefined): Promise<void>;
}

export type LLMSettings = {
  usageId?: string | null;
  model?: string | null;
  baseUrl?: string | null;
  apiVersion?: string | null;
  timeout?: number | null;
  temperature?: number | null;
  topP?: number | null;
  topK?: number | null;
  maxInputTokens?: number | null;
  maxOutputTokens?: number | null;
  nativeToolCalling?: boolean | null;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'none' | null;
};

export type ServerSettings = {
  serverUrl: string;
};

export type AgentSettings = {
  enableSecurityAnalyzer?: boolean;
};

export type ConversationSettings = {
  maxIterations?: number;
};

export type ConfirmationSettings = {
  policy?: 'never' | 'always' | 'risky';
  riskyThreshold?: 'LOW' | 'MEDIUM' | 'HIGH';
  confirmUnknown?: boolean;
};
