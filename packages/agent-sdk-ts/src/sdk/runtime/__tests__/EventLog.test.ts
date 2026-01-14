import { describe, it, expect, vi } from 'vitest';
import { EventLog } from '../EventLog';
import type { ConversationPersistence } from '../persistence';
import type { Event, MessageEvent, ActionEvent, ConversationStateUpdateEvent } from '../../types';

const createMockPersistence = (): ConversationPersistence => ({
  appendEvent: vi.fn(),
  readEvents: vi.fn().mockReturnValue([]),
  readLlmConfig: vi.fn().mockReturnValue(null),
  writeLlmConfig: vi.fn(),
  readState: vi.fn().mockReturnValue(null),
  writeState: vi.fn(),
});

const createMessageEvent = (source: 'user' | 'agent' = 'user'): MessageEvent => ({
  kind: 'MessageEvent',
  source,
  llm_message: { role: source === 'user' ? 'user' : 'assistant', content: [{ type: 'text', text: 'test' }] },
});

const createActionEvent = (): ActionEvent => ({
  kind: 'ActionEvent',
  source: 'agent',
  thought: [{ type: 'text', text: 'thinking' }],
  action: { test: true },
  tool_name: 'test_tool',
  tool_call_id: 'call_123',
  tool_call: {
    id: 'call_123',
    type: 'function',
    function: { name: 'test_tool', arguments: '{}' },
  },
  llm_response_id: 'resp_123',
});

describe('EventLog', () => {
  describe('constructor', () => {
    it('initializes with empty events', () => {
      const log = new EventLog();
      expect(log.list()).toEqual([]);
    });

    it('initializes with seed events', () => {
      const seedEvents: Event[] = [createMessageEvent()];
      const log = new EventLog({ events: seedEvents });
      const events = log.list();
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('MessageEvent');
    });

    it('normalizes seed events with id and timestamp', () => {
      const seedEvent = createMessageEvent();
      const log = new EventLog({ events: [seedEvent] });
      const events = log.list();
      expect(events[0].id).toBeDefined();
      expect(events[0].timestamp).toBeDefined();
    });

    it('preserves existing id and timestamp on seed events', () => {
      const seedEvent: MessageEvent = {
        ...createMessageEvent(),
        id: 'existing_id',
        timestamp: '2024-01-01T00:00:00Z',
      };
      const log = new EventLog({ events: [seedEvent] });
      const events = log.list();
      expect(events[0].id).toBe('existing_id');
      expect(events[0].timestamp).toBe('2024-01-01T00:00:00Z');
    });

    it('accepts persistence adapter', () => {
      const persistence = createMockPersistence();
      const log = new EventLog({ persistence });
      // Should not throw
      log.push(createMessageEvent());
      expect(persistence.appendEvent).toHaveBeenCalled();
    });
  });

  describe('push', () => {
    it('adds event to the log', () => {
      const log = new EventLog();
      const event = createMessageEvent();
      log.push(event);
      expect(log.list()).toHaveLength(1);
    });

    it('assigns id to event if missing', () => {
      const log = new EventLog();
      const event = createMessageEvent();
      const pushed = log.push(event);
      expect(pushed.id).toBeDefined();
      expect(typeof pushed.id).toBe('string');
    });

    it('assigns timestamp to event if missing', () => {
      const log = new EventLog();
      const event = createMessageEvent();
      const pushed = log.push(event);
      expect(pushed.timestamp).toBeDefined();
    });

    it('preserves existing id and timestamp', () => {
      const log = new EventLog();
      const event: MessageEvent = {
        ...createMessageEvent(),
        id: 'custom_id',
        timestamp: '2024-06-01T12:00:00Z',
      };
      const pushed = log.push(event);
      expect(pushed.id).toBe('custom_id');
      expect(pushed.timestamp).toBe('2024-06-01T12:00:00Z');
    });

    it('notifies listeners', () => {
      const log = new EventLog();
      const listener = vi.fn();
      log.on(listener);

      const event = createMessageEvent();
      log.push(event);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].kind).toBe('MessageEvent');
    });

    it('persists event to storage', () => {
      const persistence = createMockPersistence();
      const log = new EventLog({ persistence });
      const event = createMessageEvent();
      log.push(event);
      expect(persistence.appendEvent).toHaveBeenCalled();
    });

    it('throws for invalid events', () => {
      const log = new EventLog();
      const invalidEvent = { notAnEvent: true } as unknown as Event;
      expect(() => log.push(invalidEvent)).toThrow('Attempted to push invalid event');
    });
  });

  describe('replay', () => {
    it('adds multiple events to log', () => {
      const log = new EventLog();
      const events = [createMessageEvent(), createActionEvent()];
      log.replay(events);
      expect(log.list()).toHaveLength(2);
    });

    it('emits events to listeners by default', () => {
      const log = new EventLog();
      const listener = vi.fn();
      log.on(listener);

      log.replay([createMessageEvent(), createActionEvent()]);
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('skips emitting when emit=false', () => {
      const log = new EventLog();
      const listener = vi.fn();
      log.on(listener);

      log.replay([createMessageEvent()], false);
      expect(listener).not.toHaveBeenCalled();
    });

    it('does not persist replayed events', () => {
      const persistence = createMockPersistence();
      const log = new EventLog({ persistence });
      log.replay([createMessageEvent()]);
      expect(persistence.appendEvent).not.toHaveBeenCalled();
    });

    it('returns normalized events', () => {
      const log = new EventLog();
      const event = createMessageEvent();
      const replayed = log.replay([event]);
      expect(replayed[0].id).toBeDefined();
      expect(replayed[0].timestamp).toBeDefined();
    });
  });

  describe('list', () => {
    it('returns a copy of events', () => {
      const log = new EventLog();
      log.push(createMessageEvent());
      const list1 = log.list();
      const list2 = log.list();
      expect(list1).toEqual(list2);
      expect(list1).not.toBe(list2);
    });

    it('returns events in order they were added', () => {
      const log = new EventLog();
      const event1 = createMessageEvent('user');
      const event2 = createActionEvent();
      const event3 = createMessageEvent('agent');

      log.push(event1);
      log.push(event2);
      log.push(event3);

      const events = log.list();
      expect(events[0].kind).toBe('MessageEvent');
      expect((events[0] as MessageEvent).source).toBe('user');
      expect(events[1].kind).toBe('ActionEvent');
      expect(events[2].kind).toBe('MessageEvent');
      expect((events[2] as MessageEvent).source).toBe('agent');
    });
  });

  describe('on', () => {
    it('adds listener and returns unsubscribe function', () => {
      const log = new EventLog();
      const listener = vi.fn();
      const unsubscribe = log.on(listener);

      log.push(createMessageEvent());
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
      log.push(createMessageEvent());
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('supports multiple listeners', () => {
      const log = new EventLog();
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      log.on(listener1);
      log.on(listener2);

      log.push(createMessageEvent());
      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });
  });

  describe('attachPersistence', () => {
    it('replaces persistence adapter', () => {
      const oldPersistence = createMockPersistence();
      const newPersistence = createMockPersistence();
      const log = new EventLog({ persistence: oldPersistence });

      log.attachPersistence(newPersistence);
      log.push(createMessageEvent());

      expect(oldPersistence.appendEvent).not.toHaveBeenCalled();
      expect(newPersistence.appendEvent).toHaveBeenCalled();
    });
  });

  describe('persistence filtering for ConversationStateUpdateEvent', () => {
    it('does not persist llm_stream state updates', () => {
      const persistence = createMockPersistence();
      const log = new EventLog({ persistence });

      const streamEvent: ConversationStateUpdateEvent = {
        kind: 'ConversationStateUpdateEvent',
        source: 'agent',
        key: 'llm_stream',
        value: { partial: 'text' },
      };
      log.push(streamEvent);

      expect(persistence.appendEvent).not.toHaveBeenCalled();
    });

    it('does not persist llm_tool_call state updates', () => {
      const persistence = createMockPersistence();
      const log = new EventLog({ persistence });

      const toolCallEvent: ConversationStateUpdateEvent = {
        kind: 'ConversationStateUpdateEvent',
        source: 'agent',
        key: 'llm_tool_call',
        value: { name: 'test' },
      };
      log.push(toolCallEvent);

      expect(persistence.appendEvent).not.toHaveBeenCalled();
    });

    it('persists other ConversationStateUpdateEvent types', () => {
      const persistence = createMockPersistence();
      const log = new EventLog({ persistence });

      const iterationEvent: ConversationStateUpdateEvent = {
        kind: 'ConversationStateUpdateEvent',
        source: 'agent',
        iteration: 5,
      };
      log.push(iterationEvent);

      expect(persistence.appendEvent).toHaveBeenCalled();
    });

    it('persists ConversationStateUpdateEvent with other keys', () => {
      const persistence = createMockPersistence();
      const log = new EventLog({ persistence });

      const customEvent: ConversationStateUpdateEvent = {
        kind: 'ConversationStateUpdateEvent',
        source: 'agent',
        key: 'custom_key',
        value: 'custom_value',
      };
      log.push(customEvent);

      expect(persistence.appendEvent).toHaveBeenCalled();
    });
  });
});
