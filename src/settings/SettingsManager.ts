import type { SettingsAdapter, LLMSettings, ServerSettings, AgentSettings, ConversationSettings, ConfirmationSettings } from './SettingsAdapter';

export interface SavedServer {
  url: string;
  label?: string;
}

export type OpenHandsSettings = ServerSettings & {
  llm: LLMSettings;
  agent: AgentSettings;
  conversation: ConversationSettings;
  confirmation: ConfirmationSettings;
  servers: SavedServer[];
  secrets: {
    sessionApiKey?: string;
    llmApiKey?: string;
    awsAccessKeyId?: string;
    awsSecretAccessKey?: string;
  };
};

const DEFAULTS: OpenHandsSettings = {
  serverUrl: '',
  servers: [],
  llm: { usageId: 'default-llm', model: 'claude-sonnet-4-20250514' },
  agent: { enableSecurityAnalyzer: false },
  conversation: { maxIterations: 50 },
  confirmation: { policy: 'never', riskyThreshold: 'HIGH', confirmUnknown: true },
  secrets: {}
};

const normalizeNonEmptyString = (value: string | null | undefined): string | undefined => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || undefined;
};

const sanitizePositiveInteger = (value: number | null | undefined): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const int = Math.trunc(value);
  return int > 0 ? int : undefined;
};

export class SettingsManager {
  constructor(private adapter: SettingsAdapter) {}

  async get(): Promise<OpenHandsSettings> {
    const serverUrl = normalizeNonEmptyString(
      this.adapter.get<string | null>('openhands.serverUrl', DEFAULTS.serverUrl) ?? DEFAULTS.serverUrl
    );
    const isRemote = !!serverUrl;
    const servers = this.adapter.get<SavedServer[]>('openhands.servers', DEFAULTS.servers) ?? DEFAULTS.servers;
    const model = normalizeNonEmptyString(
      isRemote
        ? this.adapter.getExplicit<string>('openhands.llm.model')
        : (this.adapter.get<string | null>('openhands.llm.model', DEFAULTS.llm.model) ?? DEFAULTS.llm.model)
    );
    const llm: LLMSettings = {
      // In remote mode, omit usageId/model unless explicitly configured.
      // In local mode, we must provide a model so the local Agent can create an LLM client.
      usageId: normalizeNonEmptyString(this.adapter.getExplicit<string>('openhands.llm.usageId')),
      model,
      baseUrl: this.adapter.get<string | null>('openhands.llm.baseUrl', DEFAULTS.llm.baseUrl) ?? DEFAULTS.llm.baseUrl,
      apiVersion: this.adapter.get<string | null>('openhands.llm.apiVersion', DEFAULTS.llm.apiVersion) ?? DEFAULTS.llm.apiVersion,
      timeout: this.adapter.get<number | null>('openhands.llm.timeout', DEFAULTS.llm.timeout) ?? DEFAULTS.llm.timeout,
      temperature: this.adapter.get<number | null>('openhands.llm.temperature', DEFAULTS.llm.temperature) ?? DEFAULTS.llm.temperature,
      topP: this.adapter.get<number | null>('openhands.llm.topP', DEFAULTS.llm.topP) ?? DEFAULTS.llm.topP,
      topK: this.adapter.get<number | null>('openhands.llm.topK', DEFAULTS.llm.topK) ?? DEFAULTS.llm.topK,
      maxInputTokens: sanitizePositiveInteger(this.adapter.get<number | null>('openhands.llm.maxInputTokens', null) ?? undefined),
      maxOutputTokens: sanitizePositiveInteger(this.adapter.get<number | null>('openhands.llm.maxOutputTokens', null) ?? undefined),
      reasoningEffort: this.adapter.get<'low' | 'medium' | 'high' | 'none' | null>('openhands.llm.reasoningEffort', DEFAULTS.llm.reasoningEffort) ?? DEFAULTS.llm.reasoningEffort,
    };
    const agent: AgentSettings = {
      enableSecurityAnalyzer: this.adapter.get<boolean>('openhands.agent.enableSecurityAnalyzer', DEFAULTS.agent.enableSecurityAnalyzer) ?? DEFAULTS.agent.enableSecurityAnalyzer,
    };
    const conversation: ConversationSettings = {
      maxIterations: this.adapter.get<number>('openhands.conversation.maxIterations', DEFAULTS.conversation.maxIterations) ?? DEFAULTS.conversation.maxIterations,
    };
    const confirmation: ConfirmationSettings = {
      policy: this.adapter.get<'never' | 'always' | 'risky'>('openhands.confirmation.policy', DEFAULTS.confirmation.policy) ?? DEFAULTS.confirmation.policy,
      riskyThreshold: this.adapter.get<'LOW' | 'MEDIUM' | 'HIGH'>('openhands.confirmation.risky.threshold', DEFAULTS.confirmation.riskyThreshold) ?? DEFAULTS.confirmation.riskyThreshold,
      confirmUnknown: this.adapter.get<boolean>('openhands.confirmation.risky.confirmUnknown', DEFAULTS.confirmation.confirmUnknown) ?? DEFAULTS.confirmation.confirmUnknown,
    };
    const secrets = {
      sessionApiKey: await this.adapter.getSecret('openhands.sessionApiKey'),
      llmApiKey: await this.adapter.getSecret('openhands.llmApiKey'),
      awsAccessKeyId: await this.adapter.getSecret('openhands.awsAccessKeyId'),
      awsSecretAccessKey: await this.adapter.getSecret('openhands.awsSecretAccessKey'),
    };
    return { serverUrl, servers, llm, agent, conversation, confirmation, secrets };
  }

  async update(partial: Partial<OpenHandsSettings>, target: 'workspace' | 'global' = 'workspace'): Promise<void> {
    const ops: Promise<void>[] = [];

    if (partial.serverUrl !== undefined) {
      ops.push(this.adapter.update('openhands.serverUrl', partial.serverUrl ?? '', target));
    }

    if (partial.servers !== undefined) {
      ops.push(this.adapter.update('openhands.servers', partial.servers, target));
    }

    if (partial.llm) {
      if (partial.llm.usageId !== undefined) ops.push(this.adapter.update('openhands.llm.usageId', partial.llm.usageId, target));
      if (partial.llm.model !== undefined) ops.push(this.adapter.update('openhands.llm.model', partial.llm.model, target));
      if (partial.llm.baseUrl !== undefined) ops.push(this.adapter.update('openhands.llm.baseUrl', partial.llm.baseUrl, target));
      if (partial.llm.apiVersion !== undefined) ops.push(this.adapter.update('openhands.llm.apiVersion', partial.llm.apiVersion, target));
      if (partial.llm.timeout !== undefined) ops.push(this.adapter.update('openhands.llm.timeout', partial.llm.timeout, target));
      if (partial.llm.temperature !== undefined) ops.push(this.adapter.update('openhands.llm.temperature', partial.llm.temperature, target));
      if (partial.llm.topP !== undefined) ops.push(this.adapter.update('openhands.llm.topP', partial.llm.topP, target));
      if (partial.llm.topK !== undefined) ops.push(this.adapter.update('openhands.llm.topK', partial.llm.topK, target));
      if (partial.llm.maxInputTokens !== undefined) ops.push(this.adapter.update('openhands.llm.maxInputTokens', partial.llm.maxInputTokens, target));
      if (partial.llm.maxOutputTokens !== undefined) ops.push(this.adapter.update('openhands.llm.maxOutputTokens', partial.llm.maxOutputTokens, target));
      if (partial.llm.reasoningEffort !== undefined) ops.push(this.adapter.update('openhands.llm.reasoningEffort', partial.llm.reasoningEffort, target));
    }

    if (partial.agent) {
      if (partial.agent.enableSecurityAnalyzer !== undefined) {
        ops.push(this.adapter.update('openhands.agent.enableSecurityAnalyzer', partial.agent.enableSecurityAnalyzer, target));
      }
    }

    if (partial.conversation) {
      if (partial.conversation.maxIterations !== undefined) {
        ops.push(this.adapter.update('openhands.conversation.maxIterations', partial.conversation.maxIterations, target));
      }
    }

    if (partial.confirmation) {
      if (partial.confirmation.policy !== undefined) {
        ops.push(this.adapter.update('openhands.confirmation.policy', partial.confirmation.policy, target));
      }
      if (partial.confirmation.riskyThreshold !== undefined) {
        ops.push(this.adapter.update('openhands.confirmation.risky.threshold', partial.confirmation.riskyThreshold, target));
      }
      if (partial.confirmation.confirmUnknown !== undefined) {
        ops.push(this.adapter.update('openhands.confirmation.risky.confirmUnknown', partial.confirmation.confirmUnknown, target));
      }
    }

    if (partial.secrets) {
      if (Object.prototype.hasOwnProperty.call(partial.secrets, 'sessionApiKey')) {
        ops.push(this.adapter.storeSecret('openhands.sessionApiKey', partial.secrets.sessionApiKey));
      }
      if (Object.prototype.hasOwnProperty.call(partial.secrets, 'llmApiKey')) {
        ops.push(this.adapter.storeSecret('openhands.llmApiKey', partial.secrets.llmApiKey));
      }
      if (Object.prototype.hasOwnProperty.call(partial.secrets, 'awsAccessKeyId')) {
        ops.push(this.adapter.storeSecret('openhands.awsAccessKeyId', partial.secrets.awsAccessKeyId));
      }
      if (Object.prototype.hasOwnProperty.call(partial.secrets, 'awsSecretAccessKey')) {
        ops.push(this.adapter.storeSecret('openhands.awsSecretAccessKey', partial.secrets.awsSecretAccessKey));
      }
    }

    await Promise.all(ops);
  }
}
