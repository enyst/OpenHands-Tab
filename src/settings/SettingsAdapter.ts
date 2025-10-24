export interface SettingsAdapter {
  // Config
  get<T = unknown>(key: string, defaultValue?: T): T | undefined;
  update<T = unknown>(key: string, value: T, target?: 'workspace' | 'global'): Promise<void>;

  // Secrets
  getSecret(key: string): Promise<string | undefined>;
  storeSecret(key: string, value: string | undefined): Promise<void>;
}

export type LLMSettings = {
  usageId?: string;
  model?: string;
  baseUrl?: string;
};

export type ServerSettings = {
  serverUrl: string;
};

export type AgentSettings = {
  enableSecurityAnalyzer?: boolean;
  filterToolsRegex?: string | null;
};
