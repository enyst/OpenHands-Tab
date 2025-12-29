export type MetricsSnapshot = {
  modelName: string;
  accumulatedCost: number;
  maxBudgetPerTask?: number | null;
  accumulatedTokenUsage?: TokenUsage | null;
  /** The most recent token usage (for UI display of context size). */
  lastTokenUsage?: TokenUsage | null;
};

export type Cost = { model: string; cost: number; timestamp: number };
export type ResponseLatency = { model: string; latency: number; responseId: string };

export type TokenUsage = {
  model: string;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  contextWindow: number;
  perTurnToken: number;
  responseId: string;
};

export class Metrics {
  modelName: string;
  accumulatedCost = 0;
  inputCostPerToken: number | null = null;
  outputCostPerToken: number | null = null;
  maxBudgetPerTask: number | null = null;
  accumulatedTokenUsage: TokenUsage | null = null;
  /** The most recent token usage snapshot (for UI display of context size). */
  lastTokenUsage: TokenUsage | null = null;

  constructor(
    modelName = 'default',
    options: { inputCostPerToken?: number | null; outputCostPerToken?: number | null } = {},
  ) {
    const sanitizeRate = (rate?: number | null) =>
      typeof rate === 'number' && Number.isFinite(rate) ? rate : null;
    this.modelName = modelName;
    this.inputCostPerToken = sanitizeRate(options.inputCostPerToken);
    this.outputCostPerToken = sanitizeRate(options.outputCostPerToken);
  }

  static fromJSON(json: unknown): Metrics {
    const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object';
    if (!isRecord(json)) return new Metrics();
    const obj = json;

    const getStr = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
    const getNum = (v: unknown, fallback = 0): number => {
      const n = typeof v === 'number' ? v : Number(v ?? fallback);
      return Number.isFinite(n) ? n : fallback;
    };

    const parseTokenUsage = (raw: unknown, defaultModel: string): TokenUsage | null => {
      if (!isRecord(raw)) return null;
      return {
        model: getStr(raw['model'], defaultModel),
        promptTokens: Math.max(0, getNum(raw['promptTokens'] ?? raw['prompt_tokens'], 0)),
        completionTokens: Math.max(0, getNum(raw['completionTokens'] ?? raw['completion_tokens'], 0)),
        cacheReadTokens: Math.max(0, getNum(raw['cacheReadTokens'] ?? raw['cache_read_tokens'], 0)),
        cacheWriteTokens: Math.max(0, getNum(raw['cacheWriteTokens'] ?? raw['cache_write_tokens'], 0)),
        reasoningTokens: Math.max(0, getNum(raw['reasoningTokens'] ?? raw['reasoning_tokens'], 0)),
        contextWindow: Math.max(0, getNum(raw['contextWindow'] ?? raw['context_window'], 0)),
        perTurnToken: Math.max(0, getNum(raw['perTurnToken'] ?? raw['per_turn_token'], 0)),
        responseId: getStr(raw['responseId'] ?? raw['response_id'], ''),
      };
    };

    const m = new Metrics(getStr(obj['modelName'] ?? obj['model_name'], 'default'));
    m.accumulatedCost = getNum(obj['accumulatedCost'] ?? obj['accumulated_cost'], 0);

    const mbptA = obj['maxBudgetPerTask'];
    const mbptB = obj['max_budget_per_task'];
    if (typeof mbptA === 'number' || mbptA === null) {
      m.maxBudgetPerTask = mbptA;
    } else if (typeof mbptB === 'number' || mbptB === null) {
      m.maxBudgetPerTask = mbptB;
    } else {
      m.maxBudgetPerTask = null;
    }

    // Restore accumulatedTokenUsage
    m.accumulatedTokenUsage = parseTokenUsage(
      obj['accumulatedTokenUsage'] ?? obj['accumulated_token_usage'],
      m.modelName,
    );

    // Restore lastTokenUsage (or fallback to legacy tokenUsages array tail)
    const lastUsageRaw = obj['lastTokenUsage'] ?? obj['last_token_usage'];
    if (isRecord(lastUsageRaw)) {
      m.lastTokenUsage = parseTokenUsage(lastUsageRaw, m.modelName);
    } else {
      // Legacy fallback: read from old tokenUsages array
      const usages = obj['tokenUsages'];
      if (Array.isArray(usages) && usages.length > 0) {
        m.lastTokenUsage = parseTokenUsage(usages[usages.length - 1], m.modelName);
      }
    }

    return m;
  }

  getSnapshot(): MetricsSnapshot {
    return {
      modelName: this.modelName,
      accumulatedCost: this.accumulatedCost,
      maxBudgetPerTask: this.maxBudgetPerTask,
      accumulatedTokenUsage: this.accumulatedTokenUsage ? { ...this.accumulatedTokenUsage } : null,
      lastTokenUsage: this.lastTokenUsage ? { ...this.lastTokenUsage } : null,
    };
  }

  toJSON(): Record<string, unknown> {
    return {
      modelName: this.modelName,
      accumulatedCost: this.accumulatedCost,
      maxBudgetPerTask: this.maxBudgetPerTask,
      accumulatedTokenUsage: this.accumulatedTokenUsage,
      lastTokenUsage: this.lastTokenUsage,
    };
  }

  addCost(value: number): void {
    if (value < 0) return;
    this.accumulatedCost += value;
  }

  addResponseLatency(_seconds: number, _responseId: string): void {
    // No-op: latency tracking removed as it was unused.
    // Kept for API compatibility.
  }

  addTokenUsage(params: {
    promptTokens?: number;
    completionTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    contextWindow?: number;
    responseId?: string;
    reasoningTokens?: number;
  }): void {
    const usage: TokenUsage = {
      model: this.modelName,
      promptTokens: Math.max(0, params.promptTokens ?? 0),
      completionTokens: Math.max(0, params.completionTokens ?? 0),
      cacheReadTokens: Math.max(0, params.cacheReadTokens ?? 0),
      cacheWriteTokens: Math.max(0, params.cacheWriteTokens ?? 0),
      reasoningTokens: Math.max(0, params.reasoningTokens ?? 0),
      contextWindow: Math.max(0, params.contextWindow ?? 0),
      perTurnToken: Math.max(0, (params.promptTokens ?? 0) + (params.completionTokens ?? 0)),
      responseId: String(params.responseId ?? ''),
    };
    this.lastTokenUsage = usage;
    this.maybeAddCostForTokenUsage(usage);

    if (this.accumulatedTokenUsage === null) {
      this.accumulatedTokenUsage = { ...usage, responseId: '' };
    } else {
      this.accumulatedTokenUsage = {
        ...this.accumulatedTokenUsage,
        promptTokens: this.accumulatedTokenUsage.promptTokens + usage.promptTokens,
        completionTokens: this.accumulatedTokenUsage.completionTokens + usage.completionTokens,
        cacheReadTokens: this.accumulatedTokenUsage.cacheReadTokens + usage.cacheReadTokens,
        cacheWriteTokens: this.accumulatedTokenUsage.cacheWriteTokens + usage.cacheWriteTokens,
        reasoningTokens: this.accumulatedTokenUsage.reasoningTokens + usage.reasoningTokens,
        contextWindow: Math.max(this.accumulatedTokenUsage.contextWindow, usage.contextWindow),
        perTurnToken: usage.perTurnToken,
      };
    }
  }

  private maybeAddCostForTokenUsage(usage: TokenUsage): void {
    const inputRate = this.inputCostPerToken;
    const outputRate = this.outputCostPerToken;
    // Best-effort: only compute cost when both rates are known.
    if (typeof inputRate !== 'number' || typeof outputRate !== 'number') return;
    const cost = usage.promptTokens * inputRate + usage.completionTokens * outputRate;
    if (cost > 0) this.addCost(cost);
  }

  merge(other: Metrics): void {
    this.accumulatedCost += other.accumulatedCost;
    if (this.maxBudgetPerTask === null && other.maxBudgetPerTask !== null) {
      this.maxBudgetPerTask = other.maxBudgetPerTask;
    }

    // Take the other's lastTokenUsage as it is more recent
    if (other.lastTokenUsage) {
      this.lastTokenUsage = { ...other.lastTokenUsage };
    }

    if (!this.accumulatedTokenUsage) {
      this.accumulatedTokenUsage = other.accumulatedTokenUsage ? { ...other.accumulatedTokenUsage } : null;
    } else if (other.accumulatedTokenUsage) {
      this.accumulatedTokenUsage = {
        ...this.accumulatedTokenUsage,
        promptTokens: this.accumulatedTokenUsage.promptTokens + other.accumulatedTokenUsage.promptTokens,
        completionTokens: this.accumulatedTokenUsage.completionTokens + other.accumulatedTokenUsage.completionTokens,
        cacheReadTokens: this.accumulatedTokenUsage.cacheReadTokens + other.accumulatedTokenUsage.cacheReadTokens,
        cacheWriteTokens: this.accumulatedTokenUsage.cacheWriteTokens + other.accumulatedTokenUsage.cacheWriteTokens,
        reasoningTokens: this.accumulatedTokenUsage.reasoningTokens + other.accumulatedTokenUsage.reasoningTokens,
        contextWindow: Math.max(this.accumulatedTokenUsage.contextWindow, other.accumulatedTokenUsage.contextWindow),
        perTurnToken: other.accumulatedTokenUsage.perTurnToken,
      };
    }
  }
}
