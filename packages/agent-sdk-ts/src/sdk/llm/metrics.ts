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
  maxBudgetPerTask: number | null = null;
  costs: Cost[] = [];
  responseLatencies: ResponseLatency[] = [];
  tokenUsages: TokenUsage[] = [];
  accumulatedTokenUsage: TokenUsage | null = null;

  constructor(modelName = 'default') {
    this.modelName = modelName;
  }

  static fromJSON(json: unknown): Metrics {
    if (!json || typeof json !== 'object') return new Metrics();
    const obj = json as Record<string, any>;
    const m = new Metrics(String(obj.modelName ?? obj.model_name ?? 'default'));
    m.accumulatedCost = Number(obj.accumulatedCost ?? obj.accumulated_cost ?? 0) || 0;
    m.maxBudgetPerTask = obj.maxBudgetPerTask ?? obj.max_budget_per_task ?? null;
    m.costs = Array.isArray(obj.costs) ? obj.costs.map((c: any) => ({ model: String(c.model ?? m.modelName), cost: Number(c.cost) || 0, timestamp: Number(c.timestamp) || Date.now() })) : [];
    m.responseLatencies = Array.isArray(obj.responseLatencies)
      ? obj.responseLatencies.map((r: any) => ({ model: String(r.model ?? m.modelName), latency: Math.max(0, Number(r.latency) || 0), responseId: String(r.responseId ?? r.response_id ?? '') }))
      : [];
    m.tokenUsages = Array.isArray(obj.tokenUsages)
      ? obj.tokenUsages.map((u: any) => ({
          model: String(u.model ?? m.modelName),
          promptTokens: Math.max(0, Number(u.promptTokens ?? u.prompt_tokens) || 0),
          completionTokens: Math.max(0, Number(u.completionTokens ?? u.completion_tokens) || 0),
          cacheReadTokens: Math.max(0, Number(u.cacheReadTokens ?? u.cache_read_tokens) || 0),
          cacheWriteTokens: Math.max(0, Number(u.cacheWriteTokens ?? u.cache_write_tokens) || 0),
          reasoningTokens: Math.max(0, Number(u.reasoningTokens ?? u.reasoning_tokens) || 0),
          contextWindow: Math.max(0, Number(u.contextWindow ?? u.context_window) || 0),
          perTurnToken: Math.max(0, Number(u.perTurnToken ?? u.per_turn_token) || 0),
          responseId: String(u.responseId ?? u.response_id ?? ''),
        }))
      : [];
    const acc = obj.accumulatedTokenUsage ?? obj.accumulated_token_usage;
    m.accumulatedTokenUsage = acc
      ? {
          model: String(acc.model ?? acc.model_name ?? m.modelName),
          promptTokens: Math.max(0, Number(acc.promptTokens ?? acc.prompt_tokens) || 0),
          completionTokens: Math.max(0, Number(acc.completionTokens ?? acc.completion_tokens) || 0),
          cacheReadTokens: Math.max(0, Number(acc.cacheReadTokens ?? acc.cache_read_tokens) || 0),
          cacheWriteTokens: Math.max(0, Number(acc.cacheWriteTokens ?? acc.cache_write_tokens) || 0),
          reasoningTokens: Math.max(0, Number(acc.reasoningTokens ?? acc.reasoning_tokens) || 0),
          contextWindow: Math.max(0, Number(acc.contextWindow ?? acc.context_window) || 0),
          perTurnToken: Math.max(0, Number(acc.perTurnToken ?? acc.per_turn_token) || 0),
          responseId: String(acc.responseId ?? acc.response_id ?? ''),
        }
      : null;
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

    if (this.accumulatedTokenUsage == null) {
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

  merge(other: Metrics): void {
    this.accumulatedCost += other.accumulatedCost;
    if (this.maxBudgetPerTask == null && other.maxBudgetPerTask != null) this.maxBudgetPerTask = other.maxBudgetPerTask;
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
