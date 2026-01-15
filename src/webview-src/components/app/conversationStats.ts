import type { ConversationTotals } from './conversationTotals';

const asFiniteNumber = (raw: unknown): number | null => {
  const num = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(num) ? num : null;
};

const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
  !!candidate && typeof candidate === 'object';

type ConversationTotalsStatsOptions = {
  /**
   * Prefer using a single "main" usage bucket when computing context tokens,
   * rather than summing across all usageIds (summarizers/HAL/etc).
   */
  mainUsageId?: string;
};

const toOptionalNonEmptyString = (value: unknown): string | undefined => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed : undefined;
};

const DEFAULT_MAIN_USAGE_ID = 'agent';

export const computeConversationTotalsFromStats = (
  value: unknown,
  options: ConversationTotalsStatsOptions = {},
): ConversationTotals | null => {
  const getLastRequestPromptTokens = (metric: Record<string, unknown>): number | null => {
    // Prefer lastTokenUsage (simplified metrics format)
    const lastUsageRaw = metric.lastTokenUsage ?? metric.last_token_usage;
    if (isRecord(lastUsageRaw)) {
      const prompt = asFiniteNumber(lastUsageRaw.promptTokens ?? lastUsageRaw.prompt_tokens);
      if (prompt !== null && prompt >= 0) return prompt;
    }
    // Legacy fallback: read from old tokenUsages array
    const tokenUsagesRaw = metric.tokenUsages ?? metric.token_usages ?? metric.token_usages_history ?? metric.tokenUsagesHistory;
    if (Array.isArray(tokenUsagesRaw) && tokenUsagesRaw.length > 0) {
      const last: unknown = tokenUsagesRaw[tokenUsagesRaw.length - 1];
      if (isRecord(last)) {
        const prompt = asFiniteNumber(last.promptTokens ?? last.prompt_tokens);
        if (prompt !== null && prompt >= 0) return prompt;
      }
    }
    // Final fallback: perTurnToken from accumulated usage
    const usageRaw = metric.accumulatedTokenUsage ?? metric.accumulated_token_usage;
    if (isRecord(usageRaw)) {
      const perTurn = asFiniteNumber(usageRaw.perTurnToken ?? usageRaw.per_turn_token);
      if (perTurn !== null && perTurn >= 0) return perTurn;
    }
    return null;
  };

  if (!isRecord(value)) return null;
  const usageToMetricsRaw = value.usage_to_metrics ?? value.usageToMetrics ?? value.service_to_metrics ?? value.serviceToMetrics;
  if (!isRecord(usageToMetricsRaw)) return null;

  const configuredUsageId = toOptionalNonEmptyString(options.mainUsageId);
  const mainUsageId = configuredUsageId ?? DEFAULT_MAIN_USAGE_ID;
  const contextTokens = (() => {
    const metricRaw = usageToMetricsRaw[mainUsageId];
    if (!isRecord(metricRaw)) return 0;
    const lastPrompt = getLastRequestPromptTokens(metricRaw);
    return lastPrompt !== null && lastPrompt > 0 ? lastPrompt : 0;
  })();

  let accumulatedPromptTokens = 0;
  let accumulatedCompletionTokens = 0;
  let totalCost = 0;
  let hasKnownCost = false;

  for (const metricRaw of Object.values(usageToMetricsRaw)) {
    if (!isRecord(metricRaw)) continue;
    const costRaw = metricRaw.accumulatedCost ?? metricRaw.accumulated_cost;
    const cost = asFiniteNumber(costRaw);
    if (cost !== null && cost >= 0) {
      hasKnownCost = true;
      totalCost += cost;
    }

    const usageRaw = metricRaw.accumulatedTokenUsage ?? metricRaw.accumulated_token_usage;
    if (!isRecord(usageRaw)) continue;
    const prompt = asFiniteNumber(usageRaw.promptTokens ?? usageRaw.prompt_tokens);
    if (prompt !== null && prompt > 0) accumulatedPromptTokens += prompt;
    const completion = asFiniteNumber(usageRaw.completionTokens ?? usageRaw.completion_tokens);
    if (completion !== null && completion > 0) accumulatedCompletionTokens += completion;
  }

  const totalTokens = accumulatedPromptTokens + accumulatedCompletionTokens;
  const costIsKnown = totalTokens > 0 && hasKnownCost;

  return { contextTokens, totalTokens, totalCost, costIsKnown };
};

export const parseLlmUsageInputTokens = (value: unknown): number | null => {
  if (!isRecord(value)) return null;
  const raw = value.input ?? value.inputTokens ?? value.promptTokens ?? value.prompt_tokens;
  const num = asFiniteNumber(raw);
  if (num === null) return null;
  return Math.max(0, Math.trunc(num));
};
