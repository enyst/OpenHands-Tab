import type { AgentSettings, ConfirmationSettings, ConversationSettings, LLMSettings, ServerSettings } from '@openhands/agent-sdk-ts';
export type { AgentSettings, ConfirmationSettings, ConversationSettings, LLMSettings, ServerSettings } from '@openhands/agent-sdk-ts';

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
