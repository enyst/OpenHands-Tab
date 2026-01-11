import type {
  ActionEvent,
  AgentErrorEvent,
  Event,
  MessageEvent,
  ObservationEvent,
} from '../types';
import {
  isActionEvent,
  isAgentErrorEvent,
  isCondensation,
  isMessageEvent,
  isObservationEvent,
} from '../types';
import type { StuckDetectionThresholds } from '../types/settings';

export interface StuckDetectionResult {
  stuck: boolean;
  reason?: string;
}

const DEFAULT_THRESHOLDS: Required<StuckDetectionThresholds> = {
  actionObservation: 4,
  actionError: 3,
  monologue: 3,
  alternatingPattern: 6,
};

const clampInt = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.trunc(value));
};

const stableStringify = (value: unknown, depth = 0, maxDepth = 6): string => {
  if (depth > maxDepth) return '"<max-depth>"';
  if (value === null) return 'null';
  if (value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (typeof value === 'symbol') return JSON.stringify(value.toString());
  if (typeof value === 'function') return JSON.stringify('<function>');
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v, depth + 1, maxDepth)).join(',')}]`;
  if (typeof value !== 'object') return 'null';

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  const body = entries
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v, depth + 1, maxDepth)}`)
    .join(',');
  return `{${body}}`;
};

const actionKey = (event: ActionEvent): string =>
  stableStringify({
    source: event.source,
    thought: event.thought,
    action: event.action,
    tool_name: event.tool_name,
  });

const observationKey = (event: ObservationEvent): string =>
  stableStringify({ source: event.source, observation: event.observation, tool_name: event.tool_name });

const errorKey = (event: AgentErrorEvent): string =>
  stableStringify({ source: event.source, error: event.error, tool_name: event.tool_name });

const isUserMessage = (event: Event): event is MessageEvent =>
  isMessageEvent(event) && event.source === 'user' && event.llm_message?.role === 'user';

export class StuckDetector {
  readonly thresholds: Required<StuckDetectionThresholds>;

  constructor(thresholds: StuckDetectionThresholds = {}) {
    this.thresholds = {
      actionObservation: clampInt(thresholds.actionObservation, DEFAULT_THRESHOLDS.actionObservation),
      actionError: clampInt(thresholds.actionError, DEFAULT_THRESHOLDS.actionError),
      monologue: clampInt(thresholds.monologue, DEFAULT_THRESHOLDS.monologue),
      alternatingPattern: clampInt(thresholds.alternatingPattern, DEFAULT_THRESHOLDS.alternatingPattern),
    };
  }

  detect(events: Event[]): StuckDetectionResult {
    const lastUserMessageIndex = (() => {
      for (let i = events.length - 1; i >= 0; i -= 1) {
        const ev = events[i];
        if (ev && isUserMessage(ev)) return i;
      }
      return -1;
    })();

    if (lastUserMessageIndex === -1) {
      return { stuck: false };
    }

    const tail = events.slice(lastUserMessageIndex + 1);
    const minThreshold = Math.min(this.thresholds.actionObservation, this.thresholds.actionError, this.thresholds.monologue);
    if (tail.length < minThreshold) return { stuck: false };

    const maxNeeded = Math.max(this.thresholds.actionObservation, this.thresholds.actionError);
    const lastActions: ActionEvent[] = [];
    const lastObservations: Array<ObservationEvent | AgentErrorEvent> = [];

    for (let i = tail.length - 1; i >= 0; i -= 1) {
      const ev = tail[i];
      if (isActionEvent(ev) && lastActions.length < maxNeeded) {
        lastActions.push(ev);
      } else if ((isObservationEvent(ev) || isAgentErrorEvent(ev)) && lastObservations.length < maxNeeded) {
        lastObservations.push(ev);
      }

      if (lastActions.length >= maxNeeded && lastObservations.length >= maxNeeded) break;
    }

    if (this.isRepeatingActionObservation(lastActions, lastObservations)) {
      return { stuck: true, reason: 'Action/observation loop detected' };
    }

    if (this.isRepeatingActionError(lastActions, lastObservations)) {
      return { stuck: true, reason: 'Action/error loop detected' };
    }

    if (this.isMonologue(tail)) {
      return { stuck: true, reason: 'Agent monologue detected' };
    }

    if (tail.length >= this.thresholds.alternatingPattern && this.isAlternatingActionObservation(tail)) {
      return { stuck: true, reason: 'Alternating action/observation loop detected' };
    }

    return { stuck: false };
  }

  private isRepeatingActionObservation(
    lastActions: ActionEvent[],
    lastObservations: Array<ObservationEvent | AgentErrorEvent>,
  ): boolean {
    const threshold = this.thresholds.actionObservation;
    if (lastActions.length < threshold || lastObservations.length < threshold) return false;

    const firstAction = lastActions[0];
    const firstObservation = lastObservations[0];
    if (!firstAction || !firstObservation) return false;

    const action0 = actionKey(firstAction);
    const obs0 = isObservationEvent(firstObservation) ? observationKey(firstObservation) : errorKey(firstObservation);

    const actionsEqual = lastActions.slice(0, threshold).every((ev) => actionKey(ev) === action0);
    const observationsEqual = lastObservations.slice(0, threshold).every((ev) => {
      if (isObservationEvent(ev)) return observationKey(ev) === obs0;
      if (isAgentErrorEvent(ev)) return errorKey(ev) === obs0;
      return false;
    });

    return actionsEqual && observationsEqual;
  }

  private isRepeatingActionError(
    lastActions: ActionEvent[],
    lastObservations: Array<ObservationEvent | AgentErrorEvent>,
  ): boolean {
    const threshold = this.thresholds.actionError;
    if (lastActions.length < threshold || lastObservations.length < threshold) return false;

    const firstAction = lastActions[0];
    if (!firstAction) return false;

    const action0 = actionKey(firstAction);
    const actionsEqual = lastActions.slice(0, threshold).every((ev) => actionKey(ev) === action0);
    const errorsOnly = lastObservations.slice(0, threshold).every(isAgentErrorEvent);
    return actionsEqual && errorsOnly;
  }

  private isMonologue(events: Event[]): boolean {
    const threshold = this.thresholds.monologue;
    if (events.length < threshold) return false;

    let agentMessageCount = 0;

    for (let i = events.length - 1; i >= 0; i -= 1) {
      const ev = events[i];
      if (!ev) continue;

      if (isMessageEvent(ev)) {
        if (ev.source === 'agent') {
          agentMessageCount += 1;
          continue;
        }
        if (ev.source === 'user') break;
        break;
      }

      if (isCondensation(ev)) {
        continue;
      }

      break;
    }

    return agentMessageCount >= threshold;
  }

  private isAlternatingActionObservation(events: Event[]): boolean {
    const threshold = this.thresholds.alternatingPattern;

    const lastActions: ActionEvent[] = [];
    const lastObservations: Array<ObservationEvent | AgentErrorEvent> = [];

    for (let i = events.length - 1; i >= 0; i -= 1) {
      const ev = events[i];
      if (!ev) continue;
      if (isActionEvent(ev) && lastActions.length < threshold) {
        lastActions.push(ev);
      } else if ((isObservationEvent(ev) || isAgentErrorEvent(ev)) && lastObservations.length < threshold) {
        lastObservations.push(ev);
      }
      if (lastActions.length === threshold && lastObservations.length === threshold) break;
    }

    if (lastActions.length !== threshold || lastObservations.length !== threshold) return false;

    for (let i = 0; i < threshold - 2; i += 1) {
      const a0 = lastActions[i];
      const a2 = lastActions[i + 2];
      if (!a0 || !a2) return false;
      if (actionKey(a0) !== actionKey(a2)) return false;
    }

    for (let i = 0; i < threshold - 2; i += 1) {
      const obsA = lastObservations[i];
      const obsB = lastObservations[i + 2];
      if (!obsA || !obsB) return false;
      const keyA = isObservationEvent(obsA) ? observationKey(obsA) : errorKey(obsA);
      const keyB = isObservationEvent(obsB) ? observationKey(obsB) : errorKey(obsB);
      if (keyA !== keyB) return false;
    }

    return true;
  }
}

export default StuckDetector;
