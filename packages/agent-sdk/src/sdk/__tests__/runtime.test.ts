import { describe, expect, it, vi } from 'vitest';
import { ConversationState, EventLog, SecretRegistry, AsyncLock } from '../runtime';
import { isConversationStateUpdateEvent } from '../types';

describe('EventLog and ConversationState', () => {
  it('records state updates', () => {
    const log = new EventLog();
    const state = new ConversationState({ eventLog: log });
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

  it('reads secrets from SecretStorage when provided', async () => {
    const storage = {
      get: vi.fn(async (key: string) => (key === 'OPENAI_API_KEY' ? 'sk-storage' : undefined)),
    };
    const registry = new SecretRegistry(storage as any);

    await expect(registry.get('OPENAI_API_KEY')).resolves.toBe('sk-storage');
    expect(storage.get).toHaveBeenCalledWith('OPENAI_API_KEY');
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
