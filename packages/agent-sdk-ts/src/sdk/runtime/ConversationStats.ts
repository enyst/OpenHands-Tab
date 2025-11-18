import { Metrics } from '../llm/metrics';

export class ConversationStats {
  usage_to_metrics: Record<string, Metrics> = {};
  private _restored_usage_ids = new Set<string>();

  static fromJSON(json: unknown): ConversationStats {
    const stats = new ConversationStats();
    if (!json || typeof json !== 'object') return stats;
    const obj = json as Record<string, unknown>;
    const usage = obj['usage_to_metrics'] ?? obj['service_to_metrics'];
    if (usage && typeof usage === 'object') {
      const entries = Object.entries(usage as Record<string, unknown>);
      for (const [key, value] of entries) {
        stats.usage_to_metrics[key] = Metrics.fromJSON(value);
      }
    }
    const restored = obj['_restored_usage_ids'];
    if (Array.isArray(restored)) restored.forEach((id) => stats._restored_usage_ids.add(String(id)));
    return stats;
  }

  toJSON(): Record<string, unknown> {
    return {
      usage_to_metrics: Object.fromEntries(Object.entries(this.usage_to_metrics).map(([k, v]) => [k, v.toJSON()])),
      _restored_usage_ids: Array.from(this._restored_usage_ids),
    };
  }

  get_combined_metrics(): Metrics {
    const total = new Metrics('combined');
    for (const m of Object.values(this.usage_to_metrics)) total.merge(m);
    return total;
  }

  get_metrics_for_usage(usageId: string): Metrics {
    const metrics = this.usage_to_metrics[usageId];
    if (!metrics) throw new Error(`LLM usage does not exist ${usageId}`);
    return metrics;
  }

  register_llm(event: { llm: { usageId: string; metrics: Metrics } }): void {
    const llm = event.llm;
    const usageId = llm.usageId;
    if (usageId in this.usage_to_metrics && !this._restored_usage_ids.has(usageId)) {
      // restore existing metrics into llm
      llm.metrics.merge(this.usage_to_metrics[usageId]);
      this._restored_usage_ids.add(usageId);
    }
    if (!(usageId in this.usage_to_metrics)) {
      this.usage_to_metrics[usageId] = llm.metrics;
    }
  }
}
