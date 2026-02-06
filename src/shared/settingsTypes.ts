import type {
  AgentSettings,
  ConfirmationSettings,
  ConversationSettings,
  LLMSettings,
  ServerSettings,
} from '@openhands/agent-sdk-ts';
import type { HalMode } from './halTypes';

export interface SavedServer {
  url: string;
  label?: string;
}

export type HalSettings = {
  enabled: boolean;
  mode: HalMode;
  llmProfileId: string;
  userName: string;
  voiceAId?: string;
  voiceUserId?: string;
  modelId?: string;
  volume: number;
  cache: boolean;
};

export type OpenHandsSettingsSecrets = {
  /**
   * Remote-mode credentials are injected by the extension host at runtime.
   *
   * These values are intentionally not persisted via `SettingsManager.update()`
   * because they live in per-server VS Code SecretStorage slots.
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

export type OpenHandsSettings = ServerSettings & {
  llm: LLMSettings;
  oracle?: { profileId?: string | null };
  agent: AgentSettings;
  conversation: ConversationSettings;
  confirmation: ConfirmationSettings;
  hal: HalSettings;
  servers: SavedServer[];
  secrets: OpenHandsSettingsSecrets;
};
