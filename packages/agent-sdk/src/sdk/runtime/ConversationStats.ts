import { Metrics } from '../llm/metrics';

export class ConversationStats {
  usageToMetrics: Record<string, Metrics> = {};
  private restoredUsageIds = new Set<string>();

  static fromJSON(json: unknown): ConversationStats {
    const stats = new ConversationStats();
    if (!json || typeof json !== 'object') return stats;
    const obj = json as Record<string, unknown>;
    const usage = obj['usage_to_metrics'] ?? obj['service_to_metrics'];
    if (usage && typeof usage === 'object') {
      const entries = Object.entries(usage as Record<string, unknown>);
      for (const [key, value] of entries) {
        stats.usageToMetrics[key] = Metrics.fromJSON(value);
      }
    }
    const restored = obj['_restored_usage_ids'];
    if (Array.isArray(restored)) restored.forEach((id) => stats.restoredUsageIds.add(String(id)));
    return stats;
  }

  toJSON(): Record<string, unknown> {
    return {
      usage_to_metrics: Object.fromEntries(Object.entries(this.usageToMetrics).map(([k, v]) => [k, v.toJSON()])),
      _restored_usage_ids: Array.from(this.restoredUsageIds),
    };
  }

  restore(other: ConversationStats): void {
    this.usageToMetrics = other.usageToMetrics;
    this.restoredUsageIds = new Set(other.restoredUsageIds);
  }

  clear(): void {
    this.usageToMetrics = {};
    this.restoredUsageIds.clear();
  }

  getCombinedMetrics(): Metrics {
    const total = new Metrics('combined');
    for (const m of Object.values(this.usageToMetrics)) total.merge(m);
    return total;
  }

  getMetricsForUsage(usageId: string): Metrics {
    const metrics = this.usageToMetrics[usageId];
    if (!metrics) throw new Error(`LLM usage does not exist ${usageId}`);
    return metrics;
  }

  registerLlm(event: { llm: { usageId: string; metrics: Metrics } }): void {
    const llm = event.llm;
    const usageId = llm.usageId;
    const existing = this.usageToMetrics[usageId];
    if (existing && existing !== llm.metrics) {
      // Preserve accumulated metrics when the client is rebuilt for the same usageId (e.g. profile switching).
      llm.metrics.merge(existing);
      this.restoredUsageIds.add(usageId);
    }
    // Ensure we track the live metrics object.
    this.usageToMetrics[usageId] = llm.metrics;
  }
}
