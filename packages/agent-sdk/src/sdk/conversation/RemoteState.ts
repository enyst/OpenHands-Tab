import type { Event } from '../types';
import { isConversationStateUpdateEvent } from '../types';

export interface RemoteStateSnapshot {
  executionStatus?: string;
  agentStatus?: string;
  confirmationPolicy?: unknown;
  securityAnalyzer?: unknown;
  maxIterations?: number;
  stuckDetection?: boolean;
  stats?: unknown;
  [key: string]: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export class RemoteState {
  private readonly raw: Record<string, unknown> = {};

  reset(): void {
    for (const key of Object.keys(this.raw)) {
      delete this.raw[key];
    }
  }

  applyEvent(event: Event): void {
    if (!isConversationStateUpdateEvent(event)) return;

    if (typeof event.agent_status === 'string') {
      this.raw.agent_status = event.agent_status;
    }
    if (typeof event.iteration === 'number') {
      this.raw.iteration = event.iteration;
    }

    const key = typeof event.key === 'string' ? event.key : undefined;
    const value = event.value;

    if (!key) return;

    if (key === 'full_state' && isRecord(value)) {
      Object.assign(this.raw, value);
      return;
    }

    this.raw[key] = value;
  }

  applySnapshot(snapshot: unknown): void {
    if (!isRecord(snapshot)) return;
    Object.assign(this.raw, snapshot);
  }

  get snapshot(): RemoteStateSnapshot {
    const executionStatus = typeof this.raw.execution_status === 'string' ? this.raw.execution_status : undefined;
    const agentStatus = typeof this.raw.agent_status === 'string' ? this.raw.agent_status : undefined;

    return {
      ...this.raw,
      executionStatus,
      agentStatus,
      confirmationPolicy: this.raw.confirmation_policy,
      securityAnalyzer: this.raw.security_analyzer,
      maxIterations: typeof this.raw.max_iterations === 'number' ? this.raw.max_iterations : undefined,
      stuckDetection: typeof this.raw.stuck_detection === 'boolean' ? this.raw.stuck_detection : undefined,
      stats: this.raw.stats,
    };
  }

  get executionStatus(): string | undefined {
    return this.snapshot.executionStatus;
  }

  get confirmationPolicy(): unknown {
    return this.snapshot.confirmationPolicy;
  }

  get stats(): unknown {
    return this.snapshot.stats;
  }
}

export default RemoteState;
