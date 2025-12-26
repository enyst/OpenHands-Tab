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
  /**
   * Label hints to match against `usage_to_labels` (e.g. active profile name/id).
   */
  mainUsageLabels?: Array<string | null | undefined>;
};

const toOptionalNonEmptyString = (value: unknown): string | undefined => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed : undefined;
};

export const computeConversationTotalsFromStats = (
  value: unknown,
  options: ConversationTotalsStatsOptions = {},
): ConversationTotals | null => {
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

  const usageToLabelsRaw = value.usage_to_labels ?? value.usageToLabels;
  const usageToLabels = isRecord(usageToLabelsRaw) ? usageToLabelsRaw : null;
  const labelHints = (options.mainUsageLabels ?? [])
    .map((label) => toOptionalNonEmptyString(label))
    .filter((label): label is string => typeof label === 'string');

  const pickByLabelHint = (): string | undefined => {
    if (usageToLabels && labelHints.length) {
      const normalizedLabelByUsage = new Map<string, string>();
      for (const [usageId, label] of Object.entries(usageToLabels)) {
        const normalized = toOptionalNonEmptyString(label);
        if (normalized) normalizedLabelByUsage.set(usageId, normalized);
      }
      for (const hint of labelHints) {
        for (const [usageId, label] of normalizedLabelByUsage.entries()) {
          if (label === hint) return usageId;
        }
      }
    }
    return undefined;
  };

  const pickByFallbackId = (): string | undefined => {
    for (const fallbackId of ['default', 'default-llm']) {
      if (Object.prototype.hasOwnProperty.call(usageToMetricsRaw, fallbackId)) return fallbackId;
    }
    return undefined;
  };

  const pickBySingleUsage = (): string | undefined => {
    const usageIds = Object.keys(usageToMetricsRaw);
    return usageIds.length === 1 ? usageIds[0] : undefined;
  };

  const pickByHeuristic = (): string | undefined => {
    // Best-effort heuristic: pick the usage with the largest last prompt token count.
    let best: { usageId: string; promptTokens: number } | null = null;
    for (const [usageId, metricRaw] of Object.entries(usageToMetricsRaw)) {
      if (!isRecord(metricRaw)) continue;
      const lastPrompt = getLastRequestPromptTokens(metricRaw);
      if (lastPrompt === null) continue;
      if (!best || lastPrompt > best.promptTokens) {
        best = { usageId, promptTokens: lastPrompt };
      }
    }
    return best?.usageId;
  };

  const pickMainUsageId = (): string | undefined => {
    const explicitUsageId = toOptionalNonEmptyString(options.mainUsageId);
    if (explicitUsageId) {
      return Object.prototype.hasOwnProperty.call(usageToMetricsRaw, explicitUsageId)
        ? explicitUsageId
        : undefined;
    }

    return pickByLabelHint()
      ?? pickByFallbackId()
      ?? pickBySingleUsage()
      ?? pickByHeuristic();
  };

  const mainUsageId = pickMainUsageId();
  const contextTokens = (() => {
    if (!mainUsageId) return 0;
    const metricRaw = usageToMetricsRaw[mainUsageId];
    if (!isRecord(metricRaw)) return 0;
    const lastPrompt = getLastRequestPromptTokens(metricRaw);
    return lastPrompt !== null && lastPrompt > 0 ? lastPrompt : 0;
  })();

  let accumulatedPromptTokens = 0;
  let accumulatedCompletionTokens = 0;
  let totalCost = 0;

  for (const metricRaw of Object.values(usageToMetricsRaw)) {
    if (!isRecord(metricRaw)) continue;
    const costRaw = metricRaw.accumulatedCost ?? metricRaw.accumulated_cost;
    const cost = asFiniteNumber(costRaw);
    if (cost !== null && cost > 0) totalCost += cost;

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
  const num = asFiniteNumber(raw);
  if (num === null) return null;
  return Math.max(0, Math.trunc(num));
};
