import type { SettingsAdapter, LLMSettings, ServerSettings, AgentSettings } from './SettingsAdapter';

export type OpenHandsSettings = ServerSettings & {
  llm: LLMSettings;
  agent: AgentSettings;
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
  agent: { enableSecurityAnalyzer: false, filterToolsRegex: null },
  secrets: {}
};

export class SettingsManager {
  constructor(private adapter: SettingsAdapter) {}

  async get(): Promise<OpenHandsSettings> {
    const serverUrl = this.adapter.get<string>('openhands.serverUrl', DEFAULTS.serverUrl) ?? DEFAULTS.serverUrl;
    const llm: LLMSettings = {
      usageId: this.adapter.get<string>('openhands.llm.usageId', DEFAULTS.llm.usageId) ?? DEFAULTS.llm.usageId,
      model: this.adapter.get<string>('openhands.llm.model', DEFAULTS.llm.model) ?? DEFAULTS.llm.model,
      baseUrl: this.adapter.get<string>('openhands.llm.baseUrl', DEFAULTS.llm.baseUrl) ?? DEFAULTS.llm.baseUrl,
    };
    const agent: AgentSettings = {
      enableSecurityAnalyzer: this.adapter.get<boolean>('openhands.agent.enableSecurityAnalyzer', DEFAULTS.agent.enableSecurityAnalyzer) ?? DEFAULTS.agent.enableSecurityAnalyzer,
      filterToolsRegex: this.adapter.get<string | null>('openhands.agent.filterToolsRegex', DEFAULTS.agent.filterToolsRegex) ?? DEFAULTS.agent.filterToolsRegex,
    };
    const secrets = {
      sessionApiKey: await this.adapter.getSecret('openhands.sessionApiKey'),
      llmApiKey: await this.adapter.getSecret('openhands.llmApiKey'),
      awsAccessKeyId: await this.adapter.getSecret('openhands.awsAccessKeyId'),
      awsSecretAccessKey: await this.adapter.getSecret('openhands.awsSecretAccessKey'),
    };
    return { serverUrl, llm, agent, secrets };
  }

  async update(partial: Partial<OpenHandsSettings>, target: 'workspace' | 'global' = 'workspace'): Promise<void> {
    if (partial.serverUrl !== undefined) {
      await this.adapter.update('openhands.serverUrl', partial.serverUrl, target);
    }
    if (partial.llm) {
      if (partial.llm.usageId !== undefined) await this.adapter.update('openhands.llm.usageId', partial.llm.usageId, target);
      if (partial.llm.model !== undefined) await this.adapter.update('openhands.llm.model', partial.llm.model, target);
      if (partial.llm.baseUrl !== undefined) await this.adapter.update('openhands.llm.baseUrl', partial.llm.baseUrl, target);
    }
    if (partial.agent) {
      if (partial.agent.enableSecurityAnalyzer !== undefined) await this.adapter.update('openhands.agent.enableSecurityAnalyzer', partial.agent.enableSecurityAnalyzer, target);
      if (partial.agent.filterToolsRegex !== undefined) await this.adapter.update('openhands.agent.filterToolsRegex', partial.agent.filterToolsRegex, target);
    }
    if (partial.secrets) {
      if (Object.prototype.hasOwnProperty.call(partial.secrets, 'sessionApiKey')) {
        await this.adapter.storeSecret('openhands.sessionApiKey', partial.secrets.sessionApiKey);
      }
      if (Object.prototype.hasOwnProperty.call(partial.secrets, 'llmApiKey')) {
        await this.adapter.storeSecret('openhands.llmApiKey', partial.secrets.llmApiKey);
      }
      if (Object.prototype.hasOwnProperty.call(partial.secrets, 'awsAccessKeyId')) {
        await this.adapter.storeSecret('openhands.awsAccessKeyId', partial.secrets.awsAccessKeyId);
      }
      if (Object.prototype.hasOwnProperty.call(partial.secrets, 'awsSecretAccessKey')) {
        await this.adapter.storeSecret('openhands.awsSecretAccessKey', partial.secrets.awsSecretAccessKey);
      }
    }
  }
}
