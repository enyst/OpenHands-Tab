import type { SettingsAdapter, LLMSettings, ServerSettings, AgentSettings, ConversationSettings, ConfirmationSettings } from './SettingsAdapter';

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
  };
};

const DEFAULTS: OpenHandsSettings = {
  serverUrl: 'http://localhost:3000',
  llm: { usageId: 'default-llm', model: 'claude-sonnet-4-20250514' },
  agent: { enableSecurityAnalyzer: false },
  conversation: { maxIterations: 50 },
  confirmation: { policy: 'never', riskyThreshold: 'HIGH', confirmUnknown: true },
  secrets: {}
};

export class SettingsManager {
  constructor(private adapter: SettingsAdapter) {}

  async get(): Promise<OpenHandsSettings> {
    const serverUrl = this.adapter.get<string>('openhands.serverUrl', DEFAULTS.serverUrl) ?? DEFAULTS.serverUrl;
    const llm: LLMSettings = {
      // Only return explicitly configured usageId/model so ConnectionManager can omit them when undefined
      usageId: this.adapter.getExplicit<string>('openhands.llm.usageId'),
      model: this.adapter.getExplicit<string>('openhands.llm.model'),
      baseUrl: this.adapter.get<string | null>('openhands.llm.baseUrl', DEFAULTS.llm.baseUrl) ?? DEFAULTS.llm.baseUrl,
      apiVersion: this.adapter.get<string | null>('openhands.llm.apiVersion', DEFAULTS.llm.apiVersion) ?? DEFAULTS.llm.apiVersion,
      timeout: this.adapter.get<number | null>('openhands.llm.timeout', DEFAULTS.llm.timeout) ?? DEFAULTS.llm.timeout,
      temperature: this.adapter.get<number | null>('openhands.llm.temperature', DEFAULTS.llm.temperature) ?? DEFAULTS.llm.temperature,
      topP: this.adapter.get<number | null>('openhands.llm.topP', DEFAULTS.llm.topP) ?? DEFAULTS.llm.topP,
      topK: this.adapter.get<number | null>('openhands.llm.topK', DEFAULTS.llm.topK) ?? DEFAULTS.llm.topK,
      maxInputTokens: this.adapter.get<number | null>('openhands.llm.maxInputTokens', DEFAULTS.llm.maxInputTokens) ?? DEFAULTS.llm.maxInputTokens,
      maxOutputTokens: this.adapter.get<number | null>('openhands.llm.maxOutputTokens', DEFAULTS.llm.maxOutputTokens) ?? DEFAULTS.llm.maxOutputTokens,
      nativeToolCalling: this.adapter.get<boolean | null>('openhands.llm.nativeToolCalling', DEFAULTS.llm.nativeToolCalling) ?? DEFAULTS.llm.nativeToolCalling,
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
    return { serverUrl, llm, agent, conversation, confirmation, secrets };
  }

  async update(partial: Partial<OpenHandsSettings>, target: 'workspace' | 'global' = 'workspace'): Promise<void> {
    const ops: Promise<any>[] = [];
    if (partial.serverUrl !== undefined) {
      ops.push(this.adapter.update('openhands.serverUrl', partial.serverUrl, target));
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
      if (partial.llm.nativeToolCalling !== undefined) ops.push(this.adapter.update('openhands.llm.nativeToolCalling', partial.llm.nativeToolCalling, target));
      if (partial.llm.reasoningEffort !== undefined) ops.push(this.adapter.update('openhands.llm.reasoningEffort', partial.llm.reasoningEffort, target));
    }
    if (partial.agent) {
      if (partial.agent.enableSecurityAnalyzer !== undefined) ops.push(this.adapter.update('openhands.agent.enableSecurityAnalyzer', partial.agent.enableSecurityAnalyzer, target));
    }
    if (partial.conversation) {
      if (partial.conversation.maxIterations !== undefined) ops.push(this.adapter.update('openhands.conversation.maxIterations', partial.conversation.maxIterations, target));
    }
    if (partial.confirmation) {
      if (partial.confirmation.policy !== undefined) ops.push(this.adapter.update('openhands.confirmation.policy', partial.confirmation.policy, target));
      if (partial.confirmation.riskyThreshold !== undefined) ops.push(this.adapter.update('openhands.confirmation.risky.threshold', partial.confirmation.riskyThreshold, target));
      if (partial.confirmation.confirmUnknown !== undefined) ops.push(this.adapter.update('openhands.confirmation.risky.confirmUnknown', partial.confirmation.confirmUnknown, target));
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
