import { describe, it, expect, vi } from 'vitest';
import { ConversationState, type AgentState } from '../ConversationState';
import { EventLog } from '../EventLog';
import type { ConversationPersistence } from '../persistence';
import type { ConversationStateUpdateEvent, Event } from '../../types';

const createMockPersistence = (): ConversationPersistence => ({
  conversationId: 'test-conversation-id',
  appendEvent: vi.fn(),
  readEvents: vi.fn().mockReturnValue([]),
  readLlmConfig: vi.fn().mockReturnValue(null),
  writeLlmConfig: vi.fn(),
  readState: vi.fn().mockReturnValue(null),
  writeState: vi.fn(),
});

describe('ConversationState', () => {
  describe('constructor', () => {
    it('initializes with default state', () => {
      const state = new ConversationState();
      const snapshot = state.snapshot;
      expect(snapshot.status).toBe('idle');
      expect(snapshot.iteration).toBe(0);
      expect(snapshot.values).toEqual({});
    });

    it('initializes with provided initial state', () => {
      const initialState: AgentState = {
        status: 'running',
        iteration: 5,
        values: { foo: 'bar' },
      };
      const state = new ConversationState({ initialState });
      const snapshot = state.snapshot;
      expect(snapshot.status).toBe('running');
      expect(snapshot.iteration).toBe(5);
      expect(snapshot.values).toEqual({ foo: 'bar' });
    });

    it('accepts custom eventLog', () => {
      const eventLog = new EventLog();
      const state = new ConversationState({ eventLog });
      // Should not throw
      state.incrementIteration();
    });

    it('accepts persistence adapter', () => {
      const persistence = createMockPersistence();
      const state = new ConversationState({ persistence });
      state.incrementIteration();
      expect(persistence.writeState).toHaveBeenCalled();
    });
  });

  describe('snapshot', () => {
    it('returns a copy of the state', () => {
      const state = new ConversationState({
        initialState: { status: 'running', iteration: 1, values: { a: 1 } },
      });
      const snapshot1 = state.snapshot;
      const snapshot2 = state.snapshot;

      // Should be equal but not same reference
      expect(snapshot1).toEqual(snapshot2);
      expect(snapshot1).not.toBe(snapshot2);
      expect(snapshot1.values).not.toBe(snapshot2.values);
    });

    it('does not allow external mutation of internal state', () => {
      const state = new ConversationState();
      const snapshot = state.snapshot;
      snapshot.status = 'mutated';
      snapshot.values.hacked = true;

      expect(state.snapshot.status).toBe('idle');
      expect(state.snapshot.values).toEqual({});
    });
  });

  describe('incrementIteration', () => {
    it('increments iteration by 1', () => {
      const state = new ConversationState();
      expect(state.snapshot.iteration).toBe(0);

      const result = state.incrementIteration();
      expect(result.iteration).toBe(1);
      expect(state.snapshot.iteration).toBe(1);
    });

    it('emits ConversationStateUpdateEvent', () => {
      const eventLog = new EventLog();
      const state = new ConversationState({ eventLog });
      state.incrementIteration();

      const events = eventLog.list();
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('ConversationStateUpdateEvent');
      expect((events[0] as ConversationStateUpdateEvent).iteration).toBe(1);
    });

    it('persists state', () => {
      const persistence = createMockPersistence();
      const state = new ConversationState({ persistence });
      state.incrementIteration();
      expect(persistence.writeState).toHaveBeenCalledWith(expect.objectContaining({ iteration: 1 }));
    });
  });

  describe('setStatus', () => {
    it('updates status', () => {
      const state = new ConversationState();
      const result = state.setStatus('running');
      expect(result.status).toBe('running');
      expect(state.snapshot.status).toBe('running');
    });

    it('emits ConversationStateUpdateEvent', () => {
      const eventLog = new EventLog();
      const state = new ConversationState({ eventLog });
      state.setStatus('paused');

      const events = eventLog.list();
      expect(events).toHaveLength(1);
      expect((events[0] as ConversationStateUpdateEvent).agent_status).toBe('paused');
    });
  });

  describe('setValue', () => {
    it('sets a value in the values map', () => {
      const state = new ConversationState();
      const result = state.setValue('myKey', 'myValue');
      expect(result.values.myKey).toBe('myValue');
    });

    it('handles different value types', () => {
      const state = new ConversationState();
      state.setValue('string', 'hello');
      state.setValue('number', 42);
      state.setValue('object', { nested: true });
      state.setValue('array', [1, 2, 3]);
      state.setValue('null', null);

      const snapshot = state.snapshot;
      expect(snapshot.values.string).toBe('hello');
      expect(snapshot.values.number).toBe(42);
      expect(snapshot.values.object).toEqual({ nested: true });
      expect(snapshot.values.array).toEqual([1, 2, 3]);
      expect(snapshot.values.null).toBeNull();
    });

    it('emits ConversationStateUpdateEvent with key/value', () => {
      const eventLog = new EventLog();
      const state = new ConversationState({ eventLog });
      state.setValue('testKey', 'testValue');

      const events = eventLog.list();
      const event = events[0] as ConversationStateUpdateEvent;
      expect(event.key).toBe('testKey');
      expect(event.value).toBe('testValue');
    });

    it('can skip persistence when persist=false', () => {
      const persistence = createMockPersistence();
      const state = new ConversationState({ persistence });
      state.setValue('key', 'value', false);
      expect(persistence.writeState).not.toHaveBeenCalled();
    });
  });

  describe('restore', () => {
    it('restores state from snapshot', () => {
      const state = new ConversationState();
      state.incrementIteration();
      state.setStatus('running');

      const newState: AgentState = {
        status: 'idle',
        iteration: 100,
        values: { restored: true },
      };

      const result = state.restore(newState);
      expect(result.status).toBe('idle');
      expect(result.iteration).toBe(100);
      expect(result.values).toEqual({ restored: true });
    });

    it('creates a copy of the restored values', () => {
      const state = new ConversationState();
      const externalState: AgentState = {
        status: 'idle',
        iteration: 0,
        values: { external: true },
      };

      state.restore(externalState);
      externalState.values.external = false;
      externalState.status = 'mutated';

      expect(state.snapshot.values.external).toBe(true);
      expect(state.snapshot.status).toBe('idle');
    });
  });

  describe('loadEvents', () => {
    it('rebuilds state from ConversationStateUpdateEvents', () => {
      const state = new ConversationState();
      const events: Event[] = [
        {
          kind: 'ConversationStateUpdateEvent',
          source: 'agent',
          iteration: 5,
        },
        {
          kind: 'ConversationStateUpdateEvent',
          source: 'agent',
          agent_status: 'running',
        },
        {
          kind: 'ConversationStateUpdateEvent',
          source: 'agent',
          key: 'customKey',
          value: 'customValue',
        },
      ];

      const result = state.loadEvents(events);
      expect(result.iteration).toBe(5);
      expect(result.status).toBe('running');
      expect(result.values.customKey).toBe('customValue');
    });

    it('ignores non-ConversationStateUpdateEvents', () => {
      const state = new ConversationState();
      const events: Event[] = [
        {
          kind: 'MessageEvent',
          source: 'user',
          llm_message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        },
        {
          kind: 'ConversationStateUpdateEvent',
          source: 'agent',
          iteration: 10,
        },
      ];

      const result = state.loadEvents(events);
      expect(result.iteration).toBe(10);
    });

    it('resets state before loading', () => {
      const state = new ConversationState({
        initialState: { status: 'running', iteration: 100, values: { old: true } },
      });

      const events: Event[] = [
        {
          kind: 'ConversationStateUpdateEvent',
          source: 'agent',
          iteration: 1,
        },
      ];

      const result = state.loadEvents(events);
      expect(result.iteration).toBe(1);
      expect(result.status).toBe('idle');
      expect(result.values).not.toHaveProperty('old');
    });
  });

  describe('attachEventLog', () => {
    it('replaces the event log', () => {
      const oldLog = new EventLog();
      const newLog = new EventLog();
      const state = new ConversationState({ eventLog: oldLog });

      state.attachEventLog(newLog);
      state.incrementIteration();

      expect(oldLog.list()).toHaveLength(0);
      expect(newLog.list()).toHaveLength(1);
    });
  });

  describe('attachPersistence', () => {
    it('replaces the persistence adapter', () => {
      const oldPersistence = createMockPersistence();
      const newPersistence = createMockPersistence();
      const state = new ConversationState({ persistence: oldPersistence });

      state.attachPersistence(newPersistence);
      state.incrementIteration();

      expect(oldPersistence.writeState).not.toHaveBeenCalled();
      expect(newPersistence.writeState).toHaveBeenCalled();
    });
  });

  describe('persistSnapshot', () => {
    it('writes current state to persistence', () => {
      const persistence = createMockPersistence();
      const state = new ConversationState({ persistence });
      state.incrementIteration();
      vi.clearAllMocks();

      state.persistSnapshot();
      expect(persistence.writeState).toHaveBeenCalledWith(
        expect.objectContaining({ iteration: 1 })
      );
    });

    it('does nothing when no persistence attached', () => {
      const state = new ConversationState();
      // Should not throw
      state.persistSnapshot();
    });
  });
});
