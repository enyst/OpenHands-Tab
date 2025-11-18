import { describe, expect, it } from 'vitest';
import { ConversationState, EventLog, SecretRegistry, AsyncLock } from '../runtime';
import { isConversationStateUpdateEvent } from '../types';

describe('EventLog and ConversationState', () => {
  it('records state updates', () => {
    const log = new EventLog();
    const state = new ConversationState(log);
    state.setStatus('running');
    state.incrementIteration();

    const events = log.list();
    expect(events.length).toBe(2);
    expect(events.every(isConversationStateUpdateEvent)).toBe(true);
  });
});

describe('SecretRegistry', () => {
  it('prefers registered secrets', async () => {
    const registry = new SecretRegistry();
    registry.register('token', 'abc');
    await expect(registry.get('token')).resolves.toBe('abc');
  });
});

describe('AsyncLock', () => {
  it('serializes tasks', async () => {
    const lock = new AsyncLock();
    const order: number[] = [];

    await Promise.all([
      lock.acquire(async () => {
        order.push(1);
      }),
      lock.acquire(async () => {
        order.push(2);
      }),
    ]);

    expect(order).toEqual([1, 2]);
  });
});

