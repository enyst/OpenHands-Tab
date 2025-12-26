import type { ConversationTotals } from './conversationTotals';

const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
  !!candidate && typeof candidate === 'object';

export const computeConversationTotalsFromStats = (value: unknown): ConversationTotals | null => {
  const asFiniteNumber = (raw: unknown): number | null => {
    const num = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    return Number.isFinite(num) ? num : null;
  };
  const getTokenUsageArray = (metric: Record<string, unknown>): unknown[] | null => {
    // Token usage history keys vary across backends/versions; keep fallbacks for restores.
    const raw = metric.tokenUsages ?? metric.token_usages ?? metric.token_usages_history ?? metric.tokenUsagesHistory;
    return Array.isArray(raw) ? raw : null;
  };
  const getLastRequestPromptTokens = (metric: Record<string, unknown>): number | null => {
    const tokenUsages = getTokenUsageArray(metric);
    if (tokenUsages?.length) {
      const last = tokenUsages[tokenUsages.length - 1];
      if (isRecord(last)) {
        const prompt = asFiniteNumber(last.promptTokens ?? last.prompt_tokens);
        if (prompt !== null && prompt >= 0) return prompt;
      }
    }
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

  let contextTokens = 0;
  let accumulatedPromptTokens = 0;
  let accumulatedCompletionTokens = 0;
  let totalCost = 0;

  for (const metricRaw of Object.values(usageToMetricsRaw)) {
    if (!isRecord(metricRaw)) continue;
    const costRaw = metricRaw.accumulatedCost ?? metricRaw.accumulated_cost;
    const cost = asFiniteNumber(costRaw);
    if (cost !== null && cost > 0) totalCost += cost;

    const lastPrompt = getLastRequestPromptTokens(metricRaw);
    if (lastPrompt !== null && lastPrompt > 0) contextTokens += lastPrompt;

    const usageRaw = metricRaw.accumulatedTokenUsage ?? metricRaw.accumulated_token_usage;
    if (!isRecord(usageRaw)) continue;
    const prompt = asFiniteNumber(usageRaw.promptTokens ?? usageRaw.prompt_tokens);
    if (prompt !== null && prompt > 0) accumulatedPromptTokens += prompt;
    const completion = asFiniteNumber(usageRaw.completionTokens ?? usageRaw.completion_tokens);
    if (completion !== null && completion > 0) accumulatedCompletionTokens += completion;
  }

  const totalTokens = accumulatedPromptTokens + accumulatedCompletionTokens;
  // Best-effort: treat cost as "known" only once we have non-zero usage + non-zero cost.
  const costIsKnown = totalTokens > 0 && totalCost > 0;

  return { contextTokens, totalTokens, totalCost, costIsKnown };
};

export const parseLlmUsageInputTokens = (value: unknown): number | null => {
  if (!isRecord(value)) return null;
  const raw = value.input ?? value.inputTokens ?? value.promptTokens ?? value.prompt_tokens;
  const num = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.trunc(num));
};
