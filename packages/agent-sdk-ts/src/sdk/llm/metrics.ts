export type MetricsSnapshot = {
  modelName: string;
  accumulatedCost: number;
  maxBudgetPerTask?: number | null;
  accumulatedTokenUsage?: TokenUsage | null;
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
  costs: Cost[] = [];
  responseLatencies: ResponseLatency[] = [];
  tokenUsages: TokenUsage[] = [];
  accumulatedTokenUsage: TokenUsage | null = null;

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

    const costs = obj['costs'];
    if (Array.isArray(costs)) {
      m.costs = [];
      for (const raw of costs) {
        if (isRecord(raw)) {
          m.costs.push({
            model: getStr(raw['model'], m.modelName),
            cost: getNum(raw['cost'], 0),
            timestamp: getNum(raw['timestamp'], Date.now()),
          });
        }
      }
    }

    const lats = obj['responseLatencies'];
    if (Array.isArray(lats)) {
      m.responseLatencies = [];
      for (const raw of lats) {
        if (isRecord(raw)) {
          m.responseLatencies.push({
            model: getStr(raw['model'], m.modelName),
            latency: Math.max(0, getNum(raw['latency'], 0)),
            responseId: getStr(raw['responseId'] ?? raw['response_id'], ''),
          });
        }
      }
    }

    const usages = obj['tokenUsages'];
    if (Array.isArray(usages)) {
      m.tokenUsages = [];
      for (const raw of usages) {
        if (isRecord(raw)) {
          m.tokenUsages.push({
            model: getStr(raw['model'], m.modelName),
            promptTokens: Math.max(0, getNum(raw['promptTokens'] ?? raw['prompt_tokens'], 0)),
            completionTokens: Math.max(0, getNum(raw['completionTokens'] ?? raw['completion_tokens'], 0)),
            cacheReadTokens: Math.max(0, getNum(raw['cacheReadTokens'] ?? raw['cache_read_tokens'], 0)),
            cacheWriteTokens: Math.max(0, getNum(raw['cacheWriteTokens'] ?? raw['cache_write_tokens'], 0)),
            reasoningTokens: Math.max(0, getNum(raw['reasoningTokens'] ?? raw['reasoning_tokens'], 0)),
            contextWindow: Math.max(0, getNum(raw['contextWindow'] ?? raw['context_window'], 0)),
            perTurnToken: Math.max(0, getNum(raw['perTurnToken'] ?? raw['per_turn_token'], 0)),
            responseId: getStr(raw['responseId'] ?? raw['response_id'], ''),
          });
        }
      }
    }

    const accRaw = obj['accumulatedTokenUsage'] ?? obj['accumulated_token_usage'];
    if (isRecord(accRaw)) {
      m.accumulatedTokenUsage = {
        model: getStr(accRaw['model'] ?? accRaw['model_name'], m.modelName),
        promptTokens: Math.max(0, getNum(accRaw['promptTokens'] ?? accRaw['prompt_tokens'], 0)),
        completionTokens: Math.max(0, getNum(accRaw['completionTokens'] ?? accRaw['completion_tokens'], 0)),
        cacheReadTokens: Math.max(0, getNum(accRaw['cacheReadTokens'] ?? accRaw['cache_read_tokens'], 0)),
        cacheWriteTokens: Math.max(0, getNum(accRaw['cacheWriteTokens'] ?? accRaw['cache_write_tokens'], 0)),
        reasoningTokens: Math.max(0, getNum(accRaw['reasoningTokens'] ?? accRaw['reasoning_tokens'], 0)),
        contextWindow: Math.max(0, getNum(accRaw['contextWindow'] ?? accRaw['context_window'], 0)),
        perTurnToken: Math.max(0, getNum(accRaw['perTurnToken'] ?? accRaw['per_turn_token'], 0)),
        responseId: getStr(accRaw['responseId'] ?? accRaw['response_id'], ''),
      };
    } else {
      m.accumulatedTokenUsage = null;
    }

    return m;
  }

  getSnapshot(): MetricsSnapshot {
    return {
      modelName: this.modelName,
      accumulatedCost: this.accumulatedCost,
      maxBudgetPerTask: this.maxBudgetPerTask,
      accumulatedTokenUsage: this.accumulatedTokenUsage ? { ...this.accumulatedTokenUsage } : null,
    };
  }

  toJSON(): Record<string, unknown> {
    return {
      modelName: this.modelName,
      accumulatedCost: this.accumulatedCost,
      maxBudgetPerTask: this.maxBudgetPerTask,
      accumulatedTokenUsage: this.accumulatedTokenUsage,
      costs: this.costs,
      responseLatencies: this.responseLatencies,
      tokenUsages: this.tokenUsages,
    };
  }

  addCost(value: number): void {
    if (value < 0) return;
    this.accumulatedCost += value;
    this.costs.push({ model: this.modelName, cost: value, timestamp: Date.now() });
  }

  addResponseLatency(seconds: number, responseId: string): void {
    const latency = Math.max(0, seconds);
    this.responseLatencies.push({ model: this.modelName, latency, responseId });
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
    this.tokenUsages.push(usage);
    this.maybeAddCostForTokenUsage(usage);

    const add = {
      model: this.modelName,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      reasoningTokens: usage.reasoningTokens,
      contextWindow: usage.contextWindow,
      perTurnToken: usage.perTurnToken,
      responseId: '',
    };

    if (this.accumulatedTokenUsage === null) {
      this.accumulatedTokenUsage = add;
    } else {
      this.accumulatedTokenUsage = {
        ...this.accumulatedTokenUsage,
        promptTokens: this.accumulatedTokenUsage.promptTokens + add.promptTokens,
        completionTokens: this.accumulatedTokenUsage.completionTokens + add.completionTokens,
        cacheReadTokens: this.accumulatedTokenUsage.cacheReadTokens + add.cacheReadTokens,
        cacheWriteTokens: this.accumulatedTokenUsage.cacheWriteTokens + add.cacheWriteTokens,
        reasoningTokens: this.accumulatedTokenUsage.reasoningTokens + add.reasoningTokens,
        contextWindow: Math.max(this.accumulatedTokenUsage.contextWindow, add.contextWindow),
        perTurnToken: add.perTurnToken,
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
    if (this.maxBudgetPerTask === null && other.maxBudgetPerTask !== null) this.maxBudgetPerTask = other.maxBudgetPerTask;
    this.costs.push(...other.costs);
    this.responseLatencies.push(...other.responseLatencies);
    this.tokenUsages.push(...other.tokenUsages);

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
