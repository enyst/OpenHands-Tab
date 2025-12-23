import fs from 'fs';
import path from 'path';
import type { AgentState } from './ConversationState';
import type { Event } from '../types';
import type { LLMProvider, OpenAIChatApi, ReasoningSummary } from '../llm/types';

export type PersistedLlmConfig = {
  profileId?: string;
  provider?: LLMProvider;
  model?: string;
  usageId?: string;
  openaiApiMode?: OpenAIChatApi;
  baseUrl?: string;
  apiVersion?: string;
  timeoutSeconds?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'none';
  reasoningSummary?: ReasoningSummary;
  inputCostPerToken?: number;
  outputCostPerToken?: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toOptionalNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const toOptionalFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
};

const PROVIDERS: readonly LLMProvider[] = ['openai', 'litellm_proxy', 'openrouter', 'anthropic', 'gemini'];
const OPENAI_API_MODES: readonly OpenAIChatApi[] = ['chat_completions', 'responses'];
const REASONING_SUMMARIES: readonly ReasoningSummary[] = ['auto', 'concise', 'detailed'];
const REASONING_EFFORTS: readonly PersistedLlmConfig['reasoningEffort'][] = ['low', 'medium', 'high', 'none'];

const toOptionalProvider = (value: unknown): LLMProvider | undefined =>
  typeof value === 'string' && PROVIDERS.includes(value as LLMProvider) ? (value as LLMProvider) : undefined;

const toOptionalOpenAiApiMode = (value: unknown): OpenAIChatApi | undefined =>
  typeof value === 'string' && OPENAI_API_MODES.includes(value as OpenAIChatApi) ? (value as OpenAIChatApi) : undefined;

const toOptionalReasoningSummary = (value: unknown): ReasoningSummary | undefined =>
  typeof value === 'string' && REASONING_SUMMARIES.includes(value as ReasoningSummary) ? (value as ReasoningSummary) : undefined;

const toOptionalReasoningEffort = (value: unknown): PersistedLlmConfig['reasoningEffort'] | undefined =>
  typeof value === 'string' && REASONING_EFFORTS.includes(value as PersistedLlmConfig['reasoningEffort'])
    ? (value as PersistedLlmConfig['reasoningEffort'])
    : undefined;

export const parsePersistedLlmConfig = (value: unknown): PersistedLlmConfig | undefined => {
  if (!isRecord(value)) return undefined;

  const config: PersistedLlmConfig = {};
  const profileId = toOptionalNonEmptyString(value.profileId);
  if (profileId) config.profileId = profileId;
  const provider = toOptionalProvider(value.provider);
  if (provider) config.provider = provider;
  const model = toOptionalNonEmptyString(value.model);
  if (model) config.model = model;
  const usageId = toOptionalNonEmptyString(value.usageId);
  if (usageId) config.usageId = usageId;
  const openaiApiMode = toOptionalOpenAiApiMode(value.openaiApiMode);
  if (openaiApiMode) config.openaiApiMode = openaiApiMode;
  const baseUrl = toOptionalNonEmptyString(value.baseUrl);
  if (baseUrl) config.baseUrl = baseUrl;
  const apiVersion = toOptionalNonEmptyString(value.apiVersion);
  if (apiVersion) config.apiVersion = apiVersion;

  const timeoutSeconds = toOptionalFiniteNumber(value.timeoutSeconds);
  if (timeoutSeconds !== undefined) config.timeoutSeconds = timeoutSeconds;
  const temperature = toOptionalFiniteNumber(value.temperature);
  if (temperature !== undefined) config.temperature = temperature;
  const topP = toOptionalFiniteNumber(value.topP);
  if (topP !== undefined) config.topP = topP;
  const topK = toOptionalFiniteNumber(value.topK);
  if (topK !== undefined) config.topK = topK;

  const maxInputTokens = toOptionalFiniteNumber(value.maxInputTokens);
  if (maxInputTokens !== undefined) config.maxInputTokens = maxInputTokens;
  const maxOutputTokens = toOptionalFiniteNumber(value.maxOutputTokens);
  if (maxOutputTokens !== undefined) config.maxOutputTokens = maxOutputTokens;

  const reasoningEffort = toOptionalReasoningEffort(value.reasoningEffort);
  if (reasoningEffort) config.reasoningEffort = reasoningEffort;
  const reasoningSummary = toOptionalReasoningSummary(value.reasoningSummary);
  if (reasoningSummary) config.reasoningSummary = reasoningSummary;

  const inputCostPerToken = toOptionalFiniteNumber(value.inputCostPerToken);
  if (inputCostPerToken !== undefined) config.inputCostPerToken = inputCostPerToken;
  const outputCostPerToken = toOptionalFiniteNumber(value.outputCostPerToken);
  if (outputCostPerToken !== undefined) config.outputCostPerToken = outputCostPerToken;

  return Object.keys(config).length ? config : undefined;
};

export interface ConversationPersistence {
  conversationId: string;
  appendEvent(event: Event): void;
  readEvents(): Event[];
  writeState(state: AgentState): void;
  readState(): AgentState | undefined;
  writeLlmConfig?(config: PersistedLlmConfig): void;
  readLlmConfig?(): PersistedLlmConfig | undefined;
}

export interface FileStoreOptions {
  rootDir?: string;
  conversationId: string;
}

export class FileStore implements ConversationPersistence {
  readonly rootDir: string;
  readonly conversationId: string;
  private readonly conversationDir: string;
  private readonly eventsFile: string;
  private readonly stateFile: string;
  private readonly llmFile: string;

  constructor(options: FileStoreOptions) {
    this.rootDir = options.rootDir ?? path.join(process.cwd(), '.openhands', 'conversations');
    this.conversationId = options.conversationId;
    this.conversationDir = path.join(this.rootDir, this.conversationId);
    this.eventsFile = path.join(this.conversationDir, 'events.jsonl');
    this.stateFile = path.join(this.conversationDir, 'state.json');
    this.llmFile = path.join(this.conversationDir, 'llm.json');
    fs.mkdirSync(this.conversationDir, { recursive: true });
  }

  appendEvent(event: Event): void {
    fs.appendFileSync(this.eventsFile, `${JSON.stringify(event)}\n`, 'utf8');
  }

  readEvents(): Event[] {
    if (!fs.existsSync(this.eventsFile)) return [];
    const content = fs.readFileSync(this.eventsFile, 'utf8');
    const events: Event[] = [];
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed) as Event);
      } catch (error) {
        console.error(`[FileStore] Skipping corrupted event line: ${String(error)}`);
      }
    }
    return events;
  }

  writeState(state: AgentState): void {
    fs.writeFileSync(this.stateFile, JSON.stringify(state), 'utf8');
  }

  readState(): AgentState | undefined {
    if (!fs.existsSync(this.stateFile)) return undefined;
    try {
      const content = fs.readFileSync(this.stateFile, 'utf8');
      return JSON.parse(content) as AgentState;
    } catch (error) {
      console.error(`[FileStore] Could not read or parse state file: ${String(error)}`);
      return undefined;
    }
  }

  writeLlmConfig(config: PersistedLlmConfig): void {
    try {
      fs.writeFileSync(this.llmFile, `${JSON.stringify(config)}\n`, { encoding: 'utf8', mode: 0o600 });
    } catch (error) {
      console.error(`[FileStore] Failed to write llm config: ${String(error)}`);
    }
  }

  readLlmConfig(): PersistedLlmConfig | undefined {
    if (!fs.existsSync(this.llmFile)) return undefined;
    try {
      const content = fs.readFileSync(this.llmFile, 'utf8');
      const parsed = JSON.parse(content) as unknown;
      return parsePersistedLlmConfig(parsed);
    } catch (error) {
      console.error(`[FileStore] Could not read or parse llm config file: ${String(error)}`);
      return undefined;
    }
  }

  static listConversations(rootDir?: string): string[] {
    const dir = rootDir ?? path.join(process.cwd(), '.openhands', 'conversations');
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  }
}
