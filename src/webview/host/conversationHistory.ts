import * as nodeFs from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as readline from 'readline';
import { FileStore, isEvent, isMessageEvent, isTextContent } from '@openhands/agent-sdk-ts';

export type ConversationHistoryItem = {
  id: string;
  title?: string;
  timestamp: number;
  firstMessage?: string;
  contextTokens?: number;
};

const MAX_HISTORY_SCAN_BYTES = 512 * 1024;
const MAX_HISTORY_SCAN_LINES = 2000;
const CONVERSATION_BASE_JSON = 'conversation.json';

const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
  !!candidate && typeof candidate === 'object' && !Array.isArray(candidate);

const toNonNegativeInt = (value: unknown): number | null => {
  const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.trunc(num));
};

function getContextTokensFromLlmUsage(value: unknown): number | null {
  if (!isRecord(value)) return null;
  const raw = value.input ?? value.inputTokens ?? value.promptTokens ?? value.prompt_tokens;
  return toNonNegativeInt(raw);
}

function getContextTokensFromStats(value: unknown): number | null {
  if (!isRecord(value)) return null;
  const usageToMetricsRaw = value.usage_to_metrics ?? value.usageToMetrics ?? value.service_to_metrics ?? value.serviceToMetrics;
  if (!isRecord(usageToMetricsRaw)) return null;
  const metricRaw = usageToMetricsRaw.agent;
  if (!isRecord(metricRaw)) return null;

  const lastUsageRaw = metricRaw.lastTokenUsage ?? metricRaw.last_token_usage;
  if (isRecord(lastUsageRaw)) {
    const prompt = toNonNegativeInt(lastUsageRaw.promptTokens ?? lastUsageRaw.prompt_tokens);
    if (prompt !== null) return prompt;
  }

  const tokenUsagesRaw =
    metricRaw.tokenUsages ?? metricRaw.token_usages ?? metricRaw.token_usages_history ?? metricRaw.tokenUsagesHistory;
  if (Array.isArray(tokenUsagesRaw) && tokenUsagesRaw.length > 0) {
    const last = (tokenUsagesRaw as unknown[])[tokenUsagesRaw.length - 1];
    if (isRecord(last)) {
      const prompt = toNonNegativeInt(last.promptTokens ?? last.prompt_tokens);
      if (prompt !== null) return prompt;
    }
  }

  const usageRaw = metricRaw.accumulatedTokenUsage ?? metricRaw.accumulated_token_usage;
  if (isRecord(usageRaw)) {
    const perTurn = toNonNegativeInt(usageRaw.perTurnToken ?? usageRaw.per_turn_token);
    if (perTurn !== null) return perTurn;
  }

  return null;
}

function getContextTokensFromStateFile(state: unknown): number | undefined {
  if (!isRecord(state)) return undefined;
  const values = state.values;
  if (!isRecord(values)) return undefined;
  const llmUsageTokens = getContextTokensFromLlmUsage(values.llm_usage);
  if (llmUsageTokens !== null) return llmUsageTokens;
  const statsTokens = getContextTokensFromStats(values.stats);
  if (statsTokens !== null) return statsTokens;
  return undefined;
}

function getConversationTitleFromBaseJson(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const raw = value.title;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}

export async function persistConversationTitle(
  conversationStoreRoot: string,
  conversationId: string,
  title: string,
  outputChannel?: { appendLine(line: string): void },
): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) return;
  const dir = path.join(conversationStoreRoot, conversationId);
  const filePath = path.join(dir, CONVERSATION_BASE_JSON);

  let next: Record<string, unknown> = { title: trimmed };
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const parsed: unknown = JSON.parse(content);
    if (isRecord(parsed)) {
      next = { ...parsed, title: trimmed };
    }
  } catch {
    // ignore (missing or invalid file); we overwrite below.
  }

  try {
    await fs.writeFile(filePath, JSON.stringify(next), 'utf8');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    outputChannel?.appendLine(`[history] Failed to persist title for ${conversationId}: ${reason}`);
  }
}

async function findFirstMessageEventLine(eventsPath: string): Promise<string | undefined> {
  const stream = nodeFs.createReadStream(eventsPath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let scannedBytes = 0;
  let scannedLines = 0;

  try {
    for await (const line of rl) {
      scannedLines += 1;
      scannedBytes += Buffer.byteLength(line, 'utf8') + 1;

      if (line.includes('"MessageEvent"')) {
        return line;
      }

      if (scannedLines >= MAX_HISTORY_SCAN_LINES || scannedBytes >= MAX_HISTORY_SCAN_BYTES) {
        return undefined;
      }
    }

    return undefined;
  } finally {
    rl.close();
    stream.destroy();
  }
}

export async function getConversationHistoryList(
  conversationStoreRoot: string,
  outputChannel?: { appendLine(line: string): void }
): Promise<ConversationHistoryItem[]> {
  let ids: string[] = [];
  try {
    ids = FileStore.listConversations(conversationStoreRoot);
  } catch {
    ids = [];
  }

  return Promise.all(
    ids.map(async (id) => {
      try {
        const statePath = path.join(conversationStoreRoot, id, 'state.json');
        const eventsPath = path.join(conversationStoreRoot, id, 'events.jsonl');
        const basePath = path.join(conversationStoreRoot, id, CONVERSATION_BASE_JSON);
        const stat = await fs.stat(statePath).catch(async () => fs.stat(eventsPath));
        const timestamp = stat?.mtimeMs ?? Date.now();

        let title: string | undefined;
        try {
          const content = await fs.readFile(basePath, 'utf8');
          const parsed: unknown = JSON.parse(content);
          title = getConversationTitleFromBaseJson(parsed);
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code !== 'ENOENT') {
            const reason = err instanceof Error ? err.message : String(err);
            outputChannel?.appendLine(`[history] Failed to read conversation base JSON for ${id}: ${reason}`);
          }
        }

        let contextTokens: number | undefined;
        try {
          const stateContent = await fs.readFile(statePath, 'utf8');
          const parsed: unknown = JSON.parse(stateContent);
          contextTokens = getContextTokensFromStateFile(parsed);
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code !== 'ENOENT') {
            const reason = err instanceof Error ? err.message : String(err);
            outputChannel?.appendLine(`[history] Failed to read state for ${id}: ${reason}`);
          }
        }

        let firstMessage: string | undefined;
        try {
          const line = await findFirstMessageEventLine(eventsPath);
          if (line) {
            try {
              const parsed: unknown = JSON.parse(line);
              if (isEvent(parsed) && isMessageEvent(parsed)) {
                const msg = parsed.llm_message;
                if (msg.role === 'user') {
                  const textPart = msg.content.find(isTextContent);
                  if (textPart) firstMessage = textPart.text;
                }
              }
            } catch (err) {
              const reason = err instanceof Error ? err.message : String(err);
              outputChannel?.appendLine(`[history] Failed to parse MessageEvent for ${id}: ${reason}`);
            }
          }
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code !== 'ENOENT') {
            const reason = err instanceof Error ? err.message : String(err);
            outputChannel?.appendLine(`[history] Failed to scan events for ${id}: ${reason}`);
          }
        }
        return { id, title, timestamp: Math.floor(timestamp), firstMessage, contextTokens };
      } catch {
        return { id, timestamp: Date.now() };
      }
    })
  );
}
