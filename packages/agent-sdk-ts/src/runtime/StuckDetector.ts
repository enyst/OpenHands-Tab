import type { Event } from '../types';
import { isActionEvent, isObservationEvent } from '../types';
import { EventLog } from './EventLog';

export interface StuckResult {
  stuck: boolean;
  reason?: string;
  lastEvent?: Event;
}

export class StuckDetector {
  constructor(private readonly events: EventLog, private readonly thresholdMs = 30_000) {}

  evaluate(now: number = Date.now()): StuckResult {
    const recorded = this.events.list();
    if (recorded.length === 0) {
      return { stuck: false };
    }

    const last = recorded[recorded.length - 1];
    const timestamp = last.timestamp ? new Date(last.timestamp).getTime() : now;
    const idleMs = now - timestamp;
    if (idleMs > this.thresholdMs) {
      return { stuck: true, reason: `No events for ${idleMs}ms`, lastEvent: last };
    }

    // Detect repeated actions without observations
    const recent = recorded.slice(-5);
    const actions = recent.filter(isActionEvent);
    const observations = recent.filter(isObservationEvent);
    if (actions.length >= 2 && observations.length === 0) {
      return { stuck: true, reason: 'Actions produced no observations', lastEvent: last };
    }

    return { stuck: false, lastEvent: last };
  }
}
