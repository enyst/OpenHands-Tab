import EventEmitter from 'events';
import WebSocket, { type ClientOptions } from 'ws';
import type { BashEvent, Event, Message, TextContent } from '../types';
import { isEvent as isAgentEvent } from '../types';
import type { OpenHandsSettings } from '../types/settings';
import type { LLMProfileStoreOptions } from '../llm/profiles';
import { loadProfile } from '../llm/profiles';
import type { LLMConfiguration } from '../llm/types';
import type { ConfirmationPolicy } from '../security/confirmationPolicy';
import type { SecurityAnalyzer } from '../security/analyzer';
import { RemoteState } from './RemoteState';
import { RemoteWorkspace } from '../../workspace/RemoteWorkspace';
import { DEFAULT_REMOTE_WORKING_DIR } from '../../workspace/RemoteWorkspace';
import {
  isAgentServerWorkspace,
  type AgentServerWorkspace,
} from '../../workspace/BaseWorkspace';
import type { CommandOptions, CommandResult, DirectoryEntry, WorkspaceEncoding } from '../../workspace/types';
import { resolveToolsWithDefaultTools } from './includeDefaultTools';
import { normalizeRemoteUrl } from '../../shared/remoteUrl';
import { getRemoteAuthKeyLabelForServerUrl, isOpenHandsCloudServerUrl } from '../../shared/cloudServers';


export type ConversationStatus = 'online' | 'offline' | 'connecting';

interface ConversationHistoryPage {
  items?: unknown[];
  next_page_id?: string | null;
}

type StaticSecret = { kind: 'StaticSecret'; value: string };

export type RemoteConversationTool = {
  name: string;
  params?: Record<string, unknown>;
};

export type RemoteConversationWorkspace = {
  kind?: string;
  [key: string]: unknown;
};

export type RemoteConfirmationPolicyPayload =
  | { kind: 'AlwaysConfirm' }
  | { kind: 'NeverConfirm' }
  | { kind: 'ConfirmRisky'; threshold: 'LOW' | 'MEDIUM' | 'HIGH'; confirm_unknown: boolean };

export type RemoteSecurityAnalyzerPayload =
  | { kind: 'LLMSecurityAnalyzer' };

const toStaticSecret = (value: unknown): StaticSecret | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return { kind: 'StaticSecret', value: trimmed };
};

const normalizeRemoteServerUrl = normalizeRemoteUrl;

export interface RemoteConversationOptions {
  settings: OpenHandsSettings;
  workspaceRoot?: string;
  tools?: RemoteConversationTool[];
  includeDefaultTools?: boolean | string[];
  workspace?: AgentServerWorkspace | RemoteConversationWorkspace;
  serverUrl?: string;
  conversationId?: string;
  profileStoreOptions?: LLMProfileStoreOptions;
}

export type RemoteConversationEventMap = {
  status: (status: ConversationStatus) => void;
  event: (event: Event) => void;
  error: (err: unknown) => void;
  conversationStarted: (id: string) => void;
  terminal: (event: BashEvent) => void;
};

type ReconnectDecision =
  | { shouldReconnect: false; emitExhaustedError: boolean }
  | { shouldReconnect: true; delayMs: number };

class ReconnectBackoffPolicy {
  private retryCount = 0;
  private gaveUpReconnect = false;
  private hasEverConnected = false;

  constructor(
    private readonly retryBaseMs: number,
    private readonly retryMaxMs: number,
    private readonly maxReconnectRetries: number,
  ) {}

  markConnected() {
    this.retryCount = 0;
    this.gaveUpReconnect = false;
    this.hasEverConnected = true;
  }

  resetForManualReconnect() {
    this.retryCount = 0;
    this.gaveUpReconnect = false;
  }

  nextDecision(): ReconnectDecision {
    // If we have never successfully connected, don't spin in a retry loop.
    // In that case, surface the error and let the user manually retry.
    if (!this.hasEverConnected) {
      return { shouldReconnect: false, emitExhaustedError: false };
    }
    if (this.retryCount >= this.maxReconnectRetries) {
      const emitExhaustedError = !this.gaveUpReconnect;
      this.gaveUpReconnect = true;
      return { shouldReconnect: false, emitExhaustedError };
    }

    const base = Math.min(this.retryMaxMs, Math.floor(this.retryBaseMs * Math.pow(2, this.retryCount)));
    const jitter = Math.floor(base * 0.2 * Math.random());
    this.retryCount += 1;
    return { shouldReconnect: true, delayMs: base + jitter };
  }
}

export class RemoteConversation extends EventEmitter {
  private static readonly reconnectRetryBaseMs = 1000;
  private static readonly reconnectRetryMaxMs = 15000;
  private static readonly reconnectMaxRetries = 6;

  private serverUrl: string;
  private settings: OpenHandsSettings;
  private conversationId?: string;
  private status: ConversationStatus = 'offline';
  private readonly seenEventIds = new Set<string>();
  private ws?: WebSocket;
  private wsHandshakeTimer?: ReturnType<typeof setTimeout>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private readonly reconnectBackoffPolicy = new ReconnectBackoffPolicy(
    RemoteConversation.reconnectRetryBaseMs,
    RemoteConversation.reconnectRetryMaxMs,
    RemoteConversation.reconnectMaxRetries,
  );
  private connectAttemptId = 0;
  private readonly workspaceRoot: string;
  private readonly tools?: RemoteConversationTool[];
  private readonly includeDefaultTools?: boolean | string[];
  private readonly hasToolsOption: boolean;
  private readonly workspacePayload: RemoteConversationWorkspace;
  private readonly profileStoreOptions?: LLMProfileStoreOptions;
  private readonly ownsWorkspaceClient: boolean;
  private static readonly historyPageLimit = 100;
  private static readonly wsHandshakeTimeoutMs = 10_000;
  private static readonly httpTimeoutMs = 15_000;
  private useLegacyWsSessionKeyQueryAuth = false;

  readonly state: RemoteState;
  private workspaceClient: AgentServerWorkspace;


  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  }

  private serializeConfirmationPolicy(policy: ConfirmationPolicy): RemoteConfirmationPolicyPayload {
    if (policy.kind === 'AlwaysConfirm') return { kind: 'AlwaysConfirm' };
    if (policy.kind === 'NeverConfirm') return { kind: 'NeverConfirm' };

    if (policy.kind !== 'ConfirmRisky') {
      const kind = this.asRecord(policy)?.kind;
      throw new Error(`setConfirmationPolicy: unsupported policy kind '${typeof kind === 'string' ? kind : String(kind)}'`);
    }

    const record = this.asRecord(policy);
    const threshold = record?.threshold;
    const confirmUnknown = record?.confirmUnknown;
    const confirm_unknown = record?.confirm_unknown;

    const normalizedThreshold = typeof threshold === 'string' ? threshold.toUpperCase() : undefined;
    if (normalizedThreshold !== 'LOW' && normalizedThreshold !== 'MEDIUM' && normalizedThreshold !== 'HIGH') {
      throw new Error('setConfirmationPolicy: ConfirmRisky.threshold must be one of LOW, MEDIUM, HIGH');
    }

    const normalizedConfirmUnknown = typeof confirmUnknown === 'boolean'
      ? confirmUnknown
      : typeof confirm_unknown === 'boolean'
        ? confirm_unknown
        : true;

    return { kind: 'ConfirmRisky', threshold: normalizedThreshold, confirm_unknown: normalizedConfirmUnknown };
  }

  private serializeSecurityAnalyzer(analyzer: SecurityAnalyzer | null | undefined): RemoteSecurityAnalyzerPayload | null {
    if (analyzer === null || analyzer === undefined) return null;
    if (analyzer.kind === 'LLMSecurityAnalyzer') return { kind: 'LLMSecurityAnalyzer' };
    const kind = this.asRecord(analyzer)?.kind;
    throw new Error(`setSecurityAnalyzer: unsupported analyzer kind '${typeof kind === 'string' ? kind : String(kind)}'`);
  }

  constructor(options: RemoteConversationOptions) {
    super();
    this.state = new RemoteState();
    this.settings = options.settings;
    this.hasToolsOption = Object.prototype.hasOwnProperty.call(options, 'tools');
    this.tools = options.tools;
    this.includeDefaultTools = options.includeDefaultTools;
    this.profileStoreOptions = options.profileStoreOptions;

    const resolved = this.resolveWorkspaceOptions(options);
    this.serverUrl = resolved.serverUrl;
    this.workspaceRoot = resolved.workspaceRoot;
    this.workspacePayload = resolved.workspacePayload;
    this.workspaceClient = resolved.workspaceClient;
    this.ownsWorkspaceClient = resolved.ownsWorkspaceClient;

    if (options.conversationId) {
      this.conversationId = options.conversationId;
      this.seenEventIds.clear();
      this.state.reset();
      this.emit('conversationStarted', this.conversationId);
      void this.replayHistory().then((ok) => {
        if (!ok) {
          this.setStatus('offline');
          return;
        }
        if (this.conversationId === options.conversationId) {
          void this.connect();
        }
      }).catch((err) => {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      });
    }
  }

  private resolveWorkspaceOptions(options: RemoteConversationOptions): {
    serverUrl: string;
    workspaceRoot: string;
    workspacePayload: RemoteConversationWorkspace;
    workspaceClient: AgentServerWorkspace;
    ownsWorkspaceClient: boolean;
  } {
    if (isAgentServerWorkspace(options.workspace)) {
      const workspaceClient = options.workspace;
      return {
        serverUrl: normalizeRemoteServerUrl(workspaceClient.getServerUrl()),
        workspaceRoot: workspaceClient.root,
        workspacePayload: workspaceClient.getConversationWorkspacePayload(),
        workspaceClient,
        ownsWorkspaceClient: false,
      };
    }

    if (!options.serverUrl) {
      throw new Error('RemoteConversation requires a remote workspace or serverUrl');
    }

    const normalizedWorkspaceRoot = typeof options.workspaceRoot === 'string' && options.workspaceRoot.trim()
      ? options.workspaceRoot.trim()
      : undefined;
    const payloadWorkingDir = typeof options.workspace?.working_dir === 'string' && options.workspace.working_dir.trim()
      ? options.workspace.working_dir.trim()
      : undefined;
    const workspaceRoot = normalizedWorkspaceRoot ?? payloadWorkingDir ?? DEFAULT_REMOTE_WORKING_DIR;
    const serverUrl = normalizeRemoteServerUrl(options.serverUrl);

    return {
      serverUrl,
      workspaceRoot,
      workspacePayload: options.workspace ?? { working_dir: workspaceRoot },
      workspaceClient: this.createOwnedWorkspaceClient(serverUrl, workspaceRoot),
      ownsWorkspaceClient: true,
    };
  }

  private createOwnedWorkspaceClient(serverUrl: string, workspaceRoot: string): AgentServerWorkspace {
    const secrets = this.settings?.secrets;
    return new RemoteWorkspace({
      host: serverUrl,
      cloudApiKey: secrets?.cloudApiKey,
      runtimeSessionApiKey: secrets?.runtimeSessionApiKey,
      workingDir: workspaceRoot,
    });
  }

  getWorkspace(): AgentServerWorkspace {
    return this.workspaceClient;
  }

  runCommand(command: string, options: CommandOptions = {}): Promise<CommandResult> {
    return this.getWorkspace().runCommand(command, options);
  }

  readFile(targetPath: string, encoding?: WorkspaceEncoding): Promise<string> {
    return this.getWorkspace().readFile(targetPath, encoding);
  }

  readFileBytes(targetPath: string, options?: { maxBytes?: number }): Promise<Buffer> {
    return this.getWorkspace().readFileBytes(targetPath, options);
  }

  writeFile(targetPath: string, content: string | Buffer): Promise<void> {
    return this.getWorkspace().writeFile(targetPath, content);
  }

  remove(targetPath: string): Promise<void> {
    return this.getWorkspace().remove(targetPath);
  }

  list(targetPath?: string): Promise<DirectoryEntry[]> {
    return this.getWorkspace().list(targetPath);
  }

  ensureDirectory(targetPath: string): Promise<string> {
    return this.getWorkspace().ensureDirectory(targetPath);
  }

  gitStatus(): Promise<CommandResult> {
    return this.getWorkspace().gitStatus();
  }

  gitDiff(paths?: string[]): Promise<CommandResult> {
    return this.getWorkspace().gitDiff(paths);
  }

  get mode(): 'remote' { return 'remote'; }

  getConversationId(): string | undefined { return this.conversationId; }

  getStatus(): ConversationStatus { return this.status; }

  setSettings(settings: OpenHandsSettings) {
    const getWorkspaceAuthKey = (serverUrl: string, s: OpenHandsSettings | undefined): string | undefined => {
      const secrets = s?.secrets;
      return isOpenHandsCloudServerUrl(serverUrl)
        ? secrets?.cloudApiKey
        : secrets?.runtimeSessionApiKey;
    };

    const oldApiKey = getWorkspaceAuthKey(this.serverUrl, this.settings);
    const newApiKey = getWorkspaceAuthKey(this.serverUrl, settings);
    this.settings = settings;
    if (oldApiKey !== newApiKey) {
      // Re-probe header auth after key rotations; fall back to legacy query auth only if needed.
      this.useLegacyWsSessionKeyQueryAuth = false;
    }
    if (oldApiKey !== newApiKey && this.ownsWorkspaceClient) {
      this.workspaceClient = this.createOwnedWorkspaceClient(this.serverUrl, this.workspaceRoot);
    } else if (oldApiKey !== newApiKey) {
      this.workspaceClient.setAuth({
        cloudApiKey: settings.secrets?.cloudApiKey,
        runtimeSessionApiKey: settings.secrets?.runtimeSessionApiKey,
      });
    }
  }

  setServerUrl(url: string) {
    if (!this.ownsWorkspaceClient) {
      throw new Error('Cannot setServerUrl when RemoteConversation was created with an injected workspace');
    }
    this.serverUrl = normalizeRemoteServerUrl(url);
    this.workspaceClient = this.createOwnedWorkspaceClient(this.serverUrl, this.workspaceRoot);
    this.useLegacyWsSessionKeyQueryAuth = false;
  }

  async startNewConversation(): Promise<string | undefined> {
    try {
      if (this.ws) {
        this.ws.removeAllListeners();
        this.ws.close();
        this.ws = undefined;
      }
      this.clearWsHandshakeTimer();
      this.seenEventIds.clear();
      this.state.reset();
      this.reconnectBackoffPolicy.resetForManualReconnect();
      this.setStatus('connecting');
      const s = this.settings;
      const llm: Record<string, unknown> = {};
      const toOptionalString = (value: unknown): string | undefined => {
        if (typeof value === 'string') return value.trim() || undefined;
        if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
          const text = String(value).trim();
          return text.length > 0 ? text : undefined;
        }
        return undefined;
      };
      const profileId = toOptionalString(s?.llm.profileId);
      const model = toOptionalString(s?.llm.model);
      const baseUrl = toOptionalString(s?.llm.baseUrl);
      const apiVersion = toOptionalString(s?.llm.apiVersion);

      const profileConfig: LLMConfiguration | null = (() => {
        if (!profileId) return null;
        try {
          const profile = loadProfile(profileId, this.profileStoreOptions);
          return profile.config;
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          throw new Error(`Failed to load LLM profile '${profileId}': ${reason}`);
        }
      })();

      // NOTE: profileId is a local alias only. Remote agent-server rejects unknown llm fields
      // (like `profile_id`) with strict schema validation.
      const profileModel = profileConfig ? toOptionalString(profileConfig.model) : undefined;
      const profileBaseUrl = toOptionalString(profileConfig?.baseUrl);
      const profileApiVersion = toOptionalString(profileConfig?.apiVersion);

      const effectiveUsageId = 'agent';
      const effectiveModel = profileModel ?? model;
      const effectiveBaseUrl = profileBaseUrl ?? baseUrl;
      const effectiveApiVersion = profileApiVersion ?? apiVersion;

      llm.usage_id = effectiveUsageId;
      if (effectiveModel) llm.model = effectiveModel;
      if (effectiveBaseUrl) llm.base_url = effectiveBaseUrl;
      if (effectiveApiVersion) llm.api_version = effectiveApiVersion;

      const effectiveTimeout = profileConfig?.timeoutSeconds ?? s?.llm.timeout;
      if (typeof effectiveTimeout === 'number' && Number.isFinite(effectiveTimeout)) {
        llm.timeout = effectiveTimeout;
      }
      const effectiveTemperature = profileConfig?.temperature ?? s?.llm.temperature;
      if (typeof effectiveTemperature === 'number' && Number.isFinite(effectiveTemperature)) {
        llm.temperature = effectiveTemperature;
      }
      const effectiveTopP = profileConfig?.topP ?? s?.llm.topP;
      if (typeof effectiveTopP === 'number' && Number.isFinite(effectiveTopP)) {
        llm.top_p = effectiveTopP;
      }
      const effectiveTopK = profileConfig?.topK ?? s?.llm.topK;
      if (typeof effectiveTopK === 'number' && Number.isFinite(effectiveTopK)) {
        llm.top_k = effectiveTopK;
      }

      const maxInputTokens = profileConfig?.maxInputTokens ?? s?.llm.maxInputTokens;
      if (typeof maxInputTokens === 'number' && Number.isFinite(maxInputTokens) && maxInputTokens > 0) {
        llm.max_input_tokens = Math.trunc(maxInputTokens);
      }
      const maxOutputTokens = profileConfig?.maxOutputTokens ?? s?.llm.maxOutputTokens;
      if (typeof maxOutputTokens === 'number' && Number.isFinite(maxOutputTokens) && maxOutputTokens > 0) {
        llm.max_output_tokens = Math.trunc(maxOutputTokens);
      }

      const effectiveReasoningEffort = profileConfig?.reasoningEffort ?? s?.llm.reasoningEffort;
      if (typeof effectiveReasoningEffort === 'string' && effectiveReasoningEffort) {
        llm.reasoning_effort = effectiveReasoningEffort;
      }
      if (s?.secrets.llmApiKey) llm.api_key = s.secrets.llmApiKey;
      if (s?.secrets.awsAccessKeyId) llm.aws_access_key_id = s.secrets.awsAccessKeyId;
      if (s?.secrets.awsSecretAccessKey) llm.aws_secret_access_key = s.secrets.awsSecretAccessKey;

      const typedSecrets: Record<string, StaticSecret> = {};
      const maybeSetSecret = (key: string, value: unknown) => {
        const secret = toStaticSecret(value);
        if (secret) typedSecrets[key] = secret;
      };
      maybeSetSecret('ELEVENLABS_API_KEY', s?.secrets.halTtsApiKey);
      maybeSetSecret('GITHUB_TOKEN', s?.secrets.githubToken);
      maybeSetSecret('CUSTOM_SECRET_1', s?.secrets.customSecret1);
      maybeSetSecret('CUSTOM_SECRET_2', s?.secrets.customSecret2);
      maybeSetSecret('CUSTOM_SECRET_3', s?.secrets.customSecret3);

      const confirmation_policy: RemoteConfirmationPolicyPayload = (() => {
        const p = s?.confirmation.policy || 'never';
        if (p === 'always') return { kind: 'AlwaysConfirm' };
        if (p === 'risky') {
          return {
            kind: 'ConfirmRisky',
            threshold: s?.confirmation.riskyThreshold || 'HIGH',
            confirm_unknown: s?.confirmation.confirmUnknown ?? true,
          };
        }
        return { kind: 'NeverConfirm' };
      })();

      const clampedMaxIterations = (() => {
        const raw = s?.conversation.maxIterations;
        const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.trunc(raw) : 50;
        return Math.min(500, Math.max(1, n));
      })();
      const headers = this.getAuthHeaders();
      const defaultTools: RemoteConversationTool[] = [
        { name: 'terminal' },
        { name: 'file_editor' },
        { name: 'task_tracker' },
      ];
      const tools = resolveToolsWithDefaultTools({
        includeDefaultTools: this.includeDefaultTools,
        hasToolsOption: this.hasToolsOption,
        defaultTools,
        providedTools: this.tools,
      });
      const req = {
        agent: {
          kind: 'Agent',
          llm,
          tools,
          security_analyzer: s?.agent.enableSecurityAnalyzer ? ({ kind: 'LLMSecurityAnalyzer' } satisfies RemoteSecurityAnalyzerPayload) : undefined,
        },
        workspace: this.workspacePayload,
        secrets: typedSecrets,
        confirmation_policy,
        max_iterations: clampedMaxIterations,
      };
      const res = await this.requestApi('/api/conversations', {
        method: 'POST',
        headers,
        body: JSON.stringify(req),
      });
      if (!res.ok) {
        const info = await this.readHttpErrorInfo(res);
        const status = res.status;
        let userMessage = `Failed to start conversation (HTTP ${status})`;
        if (status === 401 || status === 403) {
          userMessage += `. Authentication failed - check your ${getRemoteAuthKeyLabelForServerUrl(this.serverUrl)} in settings.`;
        } else if (status === 404) {
          userMessage += `. Server not found at ${this.serverUrl}. Check the server URL in settings.`;
        } else if (status >= 500) {
          userMessage += '. Server error - check agent-server logs.';
        }
        if (info) userMessage += ` Details: ${info}`;
        throw new Error(userMessage);
      }
      const json = await res.json() as { id?: string; conversation_id?: string; uuid?: string };
      this.conversationId = json.id || json.conversation_id || json.uuid;
      if (!this.conversationId) {
        throw new Error('Server response missing conversation ID. Check agent-server logs.');
      }
      this.emit('conversationStarted', this.conversationId);
      void this.connect();
      return this.conversationId;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      if (errorMsg.includes('fetch') || errorMsg.includes('ECONNREFUSED')) {
        this.emit('error', new Error(`Cannot connect to agent-server at ${this.serverUrl}. Is the server running? ${errorMsg}`));
      } else {
        this.emit('error', e instanceof Error ? e : new Error(String(e)));
      }
      this.setStatus('offline');
      return undefined;
    }
  }

  async restoreConversation(id: string) {
    this.conversationId = id;
    this.seenEventIds.clear();
    this.state.reset();
    this.reconnectBackoffPolicy.resetForManualReconnect();
    this.setStatus('connecting');
    this.emit('conversationStarted', id);
    const ok = await this.replayHistory();
    if (!ok) {
      this.setStatus('offline');
      return;
    }
    void this.connect();
  }

  async pause() {
    if (!this.conversationId) {
      this.emit('error', new Error('Cannot pause: no active conversation. Start a new conversation first.'));
      return;
    }
    try {
      const headers = this.getAuthHeaders();
      const res = await this.requestApi(`/api/conversations/${this.conversationId}/pause`, { method: 'POST', headers });
      await this.assertApiOk(res, 'Failed to pause conversation');
    } catch (e) {
      this.emit('error', e instanceof Error ? e : new Error(String(e)));
    }
  }

  async resume() {
    await this.triggerRun('resume conversation');
  }

  async runPending() {
    await this.triggerRun('run pending conversation work');
  }

  async setConfirmationPolicy(policy: ConfirmationPolicy): Promise<void> {
    if (!this.conversationId) {
      throw new Error('Cannot setConfirmationPolicy: no active conversation. Start or restore a conversation first.');
    }

    const headers = this.getAuthHeaders();
    const res = await this.requestApi(`/api/conversations/${this.conversationId}/confirmation_policy`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ policy: this.serializeConfirmationPolicy(policy) }),
    });

    await this.assertApiOk(res, 'Failed to set confirmation policy');
  }

  async setSecurityAnalyzer(analyzer: SecurityAnalyzer | null): Promise<void> {
    if (!this.conversationId) {
      throw new Error('Cannot setSecurityAnalyzer: no active conversation. Start or restore a conversation first.');
    }

    const headers = this.getAuthHeaders();
    const res = await this.requestApi(`/api/conversations/${this.conversationId}/security_analyzer`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ security_analyzer: this.serializeSecurityAnalyzer(analyzer) }),
    });

    await this.assertApiOk(res, 'Failed to set security analyzer');
  }

  async updateSecrets(secrets: Record<string, string>): Promise<void> {
    if (!this.conversationId) {
      throw new Error('Cannot updateSecrets: no active conversation. Start or restore a conversation first.');
    }

    const headers = this.getAuthHeaders();
    const res = await this.requestApi(`/api/conversations/${this.conversationId}/secrets`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ secrets }),
    });

    await this.assertApiOk(res, 'Failed to update secrets');
  }

  async askAgent(question: string): Promise<string> {
    if (!this.conversationId) {
      throw new Error('Cannot askAgent: no active conversation. Start or restore a conversation first.');
    }

    const trimmed = question.trim();
    if (!trimmed) {
      throw new Error('askAgent: question must be a non-empty string');
    }

    const headers = this.getAuthHeaders();
    const res = await this.requestApi(`/api/conversations/${this.conversationId}/ask_agent`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ question: trimmed }),
    });

    await this.assertApiOk(res, 'Failed to ask agent');

    const json = await res.json().catch(() => null) as unknown;
    const response = typeof (json as { response?: unknown } | null)?.response === 'string'
      ? (json as { response: string }).response
      : undefined;
    if (!response) {
      throw new Error('askAgent: server response missing "response"');
    }

    return response;
  }


  async generateTitle(options?: { maxLength?: number; llm?: LLMConfiguration | null }): Promise<string> {
    if (!this.conversationId) {
      throw new Error('Cannot generateTitle: no active conversation. Start or restore a conversation first.');
    }

    const maxLength = typeof options?.maxLength === 'number' && Number.isFinite(options.maxLength)
      ? Math.max(1, Math.trunc(options.maxLength))
      : 50;

    const llm = options?.llm;
      const llmPayload = llm ? {
        usage_id: llm.usageId ?? 'agent',
        model: llm.model,
        ...(llm.baseUrl ? { base_url: llm.baseUrl } : {}),
        ...(llm.apiVersion ? { api_version: llm.apiVersion } : {}),
        ...(llm.apiKeyRef?.kind === 'inline' ? { api_key: llm.apiKeyRef.value } : {}),
        ...(typeof llm.timeoutSeconds === 'number' ? { timeout: llm.timeoutSeconds } : {}),
        ...(typeof llm.temperature === 'number' ? { temperature: llm.temperature } : {}),
        ...(typeof llm.topP === 'number' ? { top_p: llm.topP } : {}),
        ...(typeof llm.topK === 'number' ? { top_k: llm.topK } : {}),
      ...(typeof llm.maxInputTokens === 'number' ? { max_input_tokens: llm.maxInputTokens } : {}),
      ...(typeof llm.maxOutputTokens === 'number' ? { max_output_tokens: llm.maxOutputTokens } : {}),
      ...(typeof llm.reasoningEffort === 'string' ? { reasoning_effort: llm.reasoningEffort } : {}),
      ...(typeof llm.reasoningSummary === 'string' ? { reasoning_summary: llm.reasoningSummary } : {}),
    } : null;

    const headers = this.getAuthHeaders();
    const res = await this.requestApi(`/api/conversations/${this.conversationId}/generate_title`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ max_length: maxLength, llm: llmPayload }),
    });

    await this.assertApiOk(res, 'Failed to generate title');

    const json = await res.json().catch(() => null) as unknown;
    const title = typeof (json as { title?: unknown } | null)?.title === 'string'
      ? (json as { title: string }).title
      : undefined;
    if (!title) {
      throw new Error('generateTitle: server response missing "title"');
    }

    return title;
  }

  async condense(): Promise<void> {
    if (!this.conversationId) {
      throw new Error('Cannot condense: no active conversation. Start or restore a conversation first.');
    }

    const headers = this.getAuthHeaders();
    const res = await this.requestApi(`/api/conversations/${this.conversationId}/condense`, { method: 'POST', headers });
    await this.assertApiOk(res, 'Failed to condense conversation');
  }



  async approveAction(): Promise<void> {
    await this.respondToConfirmation(true);
  }

  async rejectAction(reason?: string): Promise<void> {
    await this.respondToConfirmation(false, reason);
  }

  private async respondToConfirmation(accept: boolean, reason?: string): Promise<void> {
    const action = accept ? 'approve' : 'reject';
    if (!this.conversationId) {
      this.emit('error', new Error(`Cannot ${action}: no active conversation.`));
      return;
    }
    try {
      const headers = this.getAuthHeaders();

      const payload: { accept: boolean; reason?: string } = { accept };
      if (!accept && reason !== undefined) payload.reason = reason;

      const res = await this.requestApi(`/api/conversations/${this.conversationId}/events/respond_to_confirmation`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      await this.assertApiOk(res, `Failed to ${action} action`);
    } catch (e) {
      this.emit('error', e instanceof Error ? e : new Error(String(e)));
    }
  }

  async sendUserMessage(text: string, options?: { run?: boolean; extendedContent?: TextContent[] }) {
    const run = options?.run !== false;
    if (!this.conversationId) {
      const id = await this.startNewConversation();
      if (!id) return;
    }
    const messagePayload: Message & { extended_content?: TextContent[] } = { role: 'user', content: [{ type: 'text', text }] };
    if (options?.extendedContent?.length) {
      messagePayload.extended_content = options.extendedContent;
    }
    if (run && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(messagePayload));
      return;
    }

    try {
      const headers = this.getAuthHeaders();
      const httpPayload = { ...messagePayload, run };
      const res = await this.requestApi(`/api/conversations/${this.conversationId}/events`, {
        method: 'POST', headers, body: JSON.stringify(httpPayload)
      });
      if (!res.ok) {
        const info = await this.readHttpErrorInfo(res);
        this.emit('error', this.formatHttpError('Failed to send message', res.status, info));
      }
    } catch (e) { this.emit('error', e); }
  }

  disconnect() {
    this.connectAttemptId += 1;
    this.clearWsHandshakeTimer();
    this.clearReconnect();
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = undefined;
    }
    this.setStatus('offline');
  }

  reconnect() {
    this.clearReconnect();
    this.reconnectBackoffPolicy.resetForManualReconnect();
    if (this.conversationId) {
      void this.connect();
    }
  }

  private setStatus(s: ConversationStatus) {
    if (this.status === s) return;
    this.status = s;
    this.emit('status', s);
  }

  private async triggerRun(actionLabel: string): Promise<void> {
    if (!this.conversationId) {
      this.emit('error', new Error(`Cannot ${actionLabel}: no active conversation. Start a new conversation first.`));
      return;
    }
    try {
      const headers = this.getAuthHeaders();
      const res = await this.requestApi(`/api/conversations/${this.conversationId}/run`, { method: 'POST', headers });
      await this.assertApiOk(res, `Failed to ${actionLabel}`);
    } catch (e) {
      this.emit('error', e instanceof Error ? e : new Error(String(e)));
    }
  }

  private getAuthHeaders(): Record<string, string> {
    return this.workspaceClient.getAuthHeaders({ 'Content-Type': 'application/json' });
  }

  private getRuntimeSessionApiKey(): string {
    return this.workspaceClient.getRuntimeSessionApiKey();
  }

  private canUseLegacyWsSessionKeyQueryAuth(): boolean {
    return !isOpenHandsCloudServerUrl(this.serverUrl) && Boolean(this.getRuntimeSessionApiKey());
  }

  private shouldRetryWithLegacyWsSessionKeyQueryAuth(err: unknown, usedLegacyWsSessionKeyQueryAuth: boolean): boolean {
    if (usedLegacyWsSessionKeyQueryAuth) return false;
    if (!this.canUseLegacyWsSessionKeyQueryAuth()) return false;
    const message = err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : '';
    return /unexpected server response:\s*(401|403)/i.test(message);
  }

  private clearReconnect() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined; }
  }

  private scheduleReconnect() {
    this.clearReconnect();
    const decision = this.reconnectBackoffPolicy.nextDecision();
    if (!decision.shouldReconnect) {
      if (decision.emitExhaustedError) {
        this.emit('error', new Error('Disconnected from agent-server. Reconnect retries exhausted.'));
      }
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      void this.connect();
    }, decision.delayMs);
  }

  private clearWsHandshakeTimer() {
    if (this.wsHandshakeTimer) {
      clearTimeout(this.wsHandshakeTimer);
      this.wsHandshakeTimer = undefined;
    }
  }

  private async fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private getApiBaseUrl(): string {
    return this.workspaceClient.getServerUrl();
  }

  private async ensureServerReady(): Promise<void> {
    if (this.workspaceClient.kind !== 'apple') return;
    const isAlive = await this.workspaceClient.isAlive();
    if (!isAlive) {
      throw new Error('External workspace server is not ready');
    }
  }

  private async requestApi(path: string, init: RequestInit): Promise<Response> {
    await this.ensureServerReady();
    return this.fetchWithTimeout(`${this.getApiBaseUrl()}${path}`, init, RemoteConversation.httpTimeoutMs);
  }

  private async readHttpErrorInfo(response: Response): Promise<string> {
    return response.text().catch(() => '');
  }

  private formatHttpError(operation: string, status: number, info: string): Error {
    return new Error(`${operation} (HTTP ${status})${info ? `: ${info}` : ''}`);
  }

  private async assertApiOk(response: Response, operation: string): Promise<void> {
    if (response.ok) return;
    const info = await this.readHttpErrorInfo(response);
    throw this.formatHttpError(operation, response.status, info);
  }

  private connect() {
    if (!this.conversationId) return;
    if (this.workspaceClient.kind !== 'apple') {
      this.openWebSocketConnection();
      return;
    }
    const connectAttemptId = ++this.connectAttemptId;
    void this.ensureServerReady().then(() => {
      if (this.connectAttemptId !== connectAttemptId) return;
      if (!this.conversationId) return;
      this.openWebSocketConnection();
    }).catch((error) => {
      if (this.connectAttemptId !== connectAttemptId) return;
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', err);
      this.setStatus('offline');
      this.scheduleReconnect();
    });
  }

  private openWebSocketConnection() {
    if (!this.conversationId) return;
    const base = this.getApiBaseUrl();
    const usedLegacyWsSessionKeyQueryAuth = this.useLegacyWsSessionKeyQueryAuth;
    const params = new URLSearchParams();
    if (usedLegacyWsSessionKeyQueryAuth) {
      params.set('session_api_key', this.getRuntimeSessionApiKey());
    }
    params.set('resend_all', 'true');
    const qs = params.toString();
    const wsUrl = `${base.replace(/^http/, 'ws')}/sockets/events/${this.conversationId}?${qs}`;
    this.setStatus('connecting');
    const wsHeaders = this.getAuthHeaders();
    delete wsHeaders['Content-Type'];
    const ws = new WebSocket(wsUrl, { headers: wsHeaders } satisfies ClientOptions);
    this.ws = ws;
    this.clearWsHandshakeTimer();
    this.wsHandshakeTimer = setTimeout(() => {
      // Ignore if another connection attempt replaced this socket.
      if (this.ws !== ws) return;
      if (ws.readyState === WebSocket.OPEN) return;
      this.emit('error', new Error(`Timed out connecting to agent-server at ${this.serverUrl}. Is the server running?`));
      this.setStatus('offline');
      try {
        (ws as unknown as { terminate?: () => void }).terminate?.();
      } catch (err) {
        void err;
      }
      try {
        ws.close();
      } catch (err) {
        void err;
      }
      this.scheduleReconnect();
    }, RemoteConversation.wsHandshakeTimeoutMs);

    ws.on('open', () => {
      if (this.ws !== ws) return;
      this.clearWsHandshakeTimer();
      this.reconnectBackoffPolicy.markConnected();
      this.setStatus('online');
    });
    ws.on('close', () => {
      if (this.ws !== ws) return;
      this.clearWsHandshakeTimer();
      this.setStatus('offline');
      this.scheduleReconnect();
    });
    ws.on('error', (err: Error) => {
      if (this.ws !== ws) return;
      if (this.shouldRetryWithLegacyWsSessionKeyQueryAuth(err, usedLegacyWsSessionKeyQueryAuth)) {
        this.clearWsHandshakeTimer();
        this.useLegacyWsSessionKeyQueryAuth = true;
        ws.removeAllListeners();
        this.ws = undefined;
        try {
          ws.close();
        } catch (closeErr) {
          void closeErr;
        }
        void this.connect();
        return;
      }
      this.clearWsHandshakeTimer();
      this.emit('error', err);
      this.setStatus('offline');
      this.scheduleReconnect();
    });
    ws.on('message', (buf: Buffer) => {
      try {
        const str = buf.toString('utf8');
        const data = JSON.parse(str) as unknown;
        const normalized = this.cloneEventPayload(data);
        if (isAgentEvent(normalized)) this.emitIfNewEvent(normalized);
        else this.emit('error', new Error(`Invalid event payload: ${JSON.stringify(normalized)}`));
      } catch (e) {
        this.emit('error', e);
      }
    });
  }

  private emitIfNewEvent(event: Event) {
    if (event?.id) {
      if (this.seenEventIds.has(event.id)) return;
      this.seenEventIds.add(event.id);
    }
    this.state.applyEvent(event);
    this.emit('event', event);
  }

  private async replayHistory(): Promise<boolean> {
    if (!this.conversationId) return true;
    const headers = this.getAuthHeaders();
    let pageId: string | undefined;
    try {
      while (true) {
        const params = new URLSearchParams({ limit: String(RemoteConversation.historyPageLimit) });
        if (pageId) params.set('page_id', pageId);
        const res = await this.requestApi(`/api/conversations/${this.conversationId}/events/search?${params.toString()}`, { headers });
        if (!res.ok) {
          const info = await this.readHttpErrorInfo(res);
          this.emit('error', this.formatHttpError('Failed to fetch conversation history', res.status, info));
          return false;
        }
        const body = await res.json() as ConversationHistoryPage;
        const items = Array.isArray(body.items) ? body.items : [];
        for (const raw of items) {
          const normalized = this.cloneEventPayload(raw);
          if (isAgentEvent(normalized)) {
            this.emitIfNewEvent(normalized);
          }
        }
        const next = body.next_page_id;
        if (!next || typeof next !== 'string') break;
        pageId = next;
      }
      return true;
    } catch (e) {
      this.emit('error', e instanceof Error ? e : new Error(String(e)));
      return false;
    }
  }

  private cloneEventPayload(payload: unknown): unknown {
    if (!payload || typeof payload !== 'object') return payload;
    if (Array.isArray(payload)) return payload.map((item) => this.cloneEventPayload(item));
    const obj = payload as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      normalized[key] = this.cloneEventPayload(value);
    }
    return normalized;
  }
}
