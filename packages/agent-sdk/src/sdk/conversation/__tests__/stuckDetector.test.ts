import { describe, it, expect } from 'vitest';
import { StuckDetector } from '../stuckDetector';
import type { ActionEvent, Event, MessageEvent, ObservationEvent, AgentErrorEvent, Condensation } from '../../types';

const createUserMessage = (): MessageEvent => ({
  kind: 'MessageEvent',
  source: 'user',
  llm_message: { role: 'user', content: [{ type: 'text', text: 'test' }] },
});

const createAgentMessage = (): MessageEvent => ({
  kind: 'MessageEvent',
  source: 'agent',
  llm_message: { role: 'assistant', content: [{ type: 'text', text: 'response' }] },
});

const createActionEvent = (thought = 'test thought', toolName = 'test_tool'): ActionEvent => ({
  kind: 'ActionEvent',
  source: 'agent',
  thought: [{ type: 'text', text: thought }],
  action: { test: true },
  tool_name: toolName,
  tool_call_id: 'call_123',
  tool_call: {
    id: 'call_123',
    type: 'function',
    function: { name: toolName, arguments: '{}' },
  },
  llm_response_id: 'resp_123',
});

const createObservationEvent = (output = 'test output', toolName = 'test_tool'): ObservationEvent => ({
  kind: 'ObservationEvent',
  source: 'environment',
  observation: { output },
  tool_name: toolName,
  tool_call_id: 'call_123',
  action_id: 'action_123',
});

const createAgentErrorEvent = (error = 'test error', toolName = 'test_tool'): AgentErrorEvent => ({
  kind: 'AgentErrorEvent',
  source: 'agent',
  error,
  tool_name: toolName,
  tool_call_id: 'call_123',
});

const createCondensation = (): Condensation => ({
  kind: 'Condensation',
  source: 'environment',
  forgotten_event_ids: ['event_1', 'event_2'],
});

describe('StuckDetector', () => {
  describe('constructor', () => {
    it('uses default thresholds when none provided', () => {
      const detector = new StuckDetector();
      expect(detector.thresholds.actionObservation).toBe(4);
      expect(detector.thresholds.actionError).toBe(3);
      expect(detector.thresholds.monologue).toBe(3);
      expect(detector.thresholds.alternatingPattern).toBe(6);
    });

    it('applies custom thresholds', () => {
      const detector = new StuckDetector({
        actionObservation: 5,
        actionError: 4,
        monologue: 2,
        alternatingPattern: 8,
      });
      expect(detector.thresholds.actionObservation).toBe(5);
      expect(detector.thresholds.actionError).toBe(4);
      expect(detector.thresholds.monologue).toBe(2);
      expect(detector.thresholds.alternatingPattern).toBe(8);
    });

    it('clamps threshold values to minimum of 1', () => {
      const detector = new StuckDetector({
        actionObservation: 0,
        actionError: -5,
      });
      expect(detector.thresholds.actionObservation).toBe(1);
      expect(detector.thresholds.actionError).toBe(1);
    });

    it('uses fallback for non-number values', () => {
      const detector = new StuckDetector({
        actionObservation: 'invalid' as unknown as number,
        actionError: NaN,
      });
      expect(detector.thresholds.actionObservation).toBe(4); // default
      expect(detector.thresholds.actionError).toBe(3); // default
    });
  });

  describe('detect', () => {
    it('returns not stuck when no user message exists', () => {
      const detector = new StuckDetector();
      const events: Event[] = [
        createActionEvent(),
        createObservationEvent(),
      ];
      const result = detector.detect(events);
      expect(result.stuck).toBe(false);
    });

    it('returns not stuck when events after user message are fewer than min threshold', () => {
      const detector = new StuckDetector();
      const events: Event[] = [
        createUserMessage(),
        createActionEvent(),
      ];
      const result = detector.detect(events);
      expect(result.stuck).toBe(false);
    });

    describe('repeating action/observation loop', () => {
      it('detects repeated identical action/observation pairs', () => {
        const detector = new StuckDetector({ actionObservation: 3 });
        const events: Event[] = [
          createUserMessage(),
          createActionEvent('same thought', 'same_tool'),
          createObservationEvent('same output', 'same_tool'),
          createActionEvent('same thought', 'same_tool'),
          createObservationEvent('same output', 'same_tool'),
          createActionEvent('same thought', 'same_tool'),
          createObservationEvent('same output', 'same_tool'),
        ];
        const result = detector.detect(events);
        expect(result.stuck).toBe(true);
        expect(result.reason).toBe('Action/observation loop detected');
      });

      it('does not detect loop when actions differ', () => {
        const detector = new StuckDetector({ actionObservation: 3 });
        const events: Event[] = [
          createUserMessage(),
          createActionEvent('thought 1', 'tool_1'),
          createObservationEvent('output', 'tool_1'),
          createActionEvent('thought 2', 'tool_2'),
          createObservationEvent('output', 'tool_2'),
          createActionEvent('thought 3', 'tool_3'),
          createObservationEvent('output', 'tool_3'),
        ];
        const result = detector.detect(events);
        expect(result.stuck).toBe(false);
      });
    });

    describe('repeating action/error loop', () => {
      it('detects repeated actions followed by errors', () => {
        const detector = new StuckDetector({ actionError: 2 });
        const events: Event[] = [
          createUserMessage(),
          createActionEvent('same thought', 'same_tool'),
          createAgentErrorEvent('error 1', 'same_tool'),
          createActionEvent('same thought', 'same_tool'),
          createAgentErrorEvent('error 2', 'same_tool'),
        ];
        const result = detector.detect(events);
        expect(result.stuck).toBe(true);
        expect(result.reason).toBe('Action/error loop detected');
      });
    });

    describe('agent monologue detection', () => {
      it('detects agent sending multiple consecutive messages', () => {
        const detector = new StuckDetector({ monologue: 3 });
        const events: Event[] = [
          createUserMessage(),
          createAgentMessage(),
          createAgentMessage(),
          createAgentMessage(),
        ];
        const result = detector.detect(events);
        expect(result.stuck).toBe(true);
        expect(result.reason).toBe('Agent monologue detected');
      });

      it('skips condensation events in monologue check', () => {
        const detector = new StuckDetector({ monologue: 3 });
        const events: Event[] = [
          createUserMessage(),
          createAgentMessage(),
          createCondensation(),
          createAgentMessage(),
          createCondensation(),
          createAgentMessage(),
        ];
        const result = detector.detect(events);
        expect(result.stuck).toBe(true);
        expect(result.reason).toBe('Agent monologue detected');
      });

      it('does not detect monologue when count is below threshold', () => {
        const detector = new StuckDetector({ monologue: 3 });
        const events: Event[] = [
          createUserMessage(),
          createAgentMessage(),
          createAgentMessage(),
        ];
        const result = detector.detect(events);
        expect(result.stuck).toBe(false);
      });
    });

    describe('alternating action/observation pattern', () => {
      it('detects alternating pattern when threshold is met', () => {
        const detector = new StuckDetector({ alternatingPattern: 4 });
        const events: Event[] = [
          createUserMessage(),
          createActionEvent('thought A', 'tool_a'),
          createObservationEvent('output A', 'tool_a'),
          createActionEvent('thought B', 'tool_b'),
          createObservationEvent('output B', 'tool_b'),
          createActionEvent('thought A', 'tool_a'),
          createObservationEvent('output A', 'tool_a'),
          createActionEvent('thought B', 'tool_b'),
          createObservationEvent('output B', 'tool_b'),
        ];
        const result = detector.detect(events);
        expect(result.stuck).toBe(true);
        expect(result.reason).toBe('Alternating action/observation loop detected');
      });

      it('does not detect alternating pattern when insufficient events', () => {
        const detector = new StuckDetector({ alternatingPattern: 6 });
        const events: Event[] = [
          createUserMessage(),
          createActionEvent('thought A', 'tool_a'),
          createObservationEvent('output A', 'tool_a'),
        ];
        const result = detector.detect(events);
        expect(result.stuck).toBe(false);
      });
    });

    it('returns not stuck when patterns do not match any detection', () => {
      const detector = new StuckDetector();
      const events: Event[] = [
        createUserMessage(),
        createActionEvent('thought 1', 'tool_1'),
        createObservationEvent('output 1', 'tool_1'),
        createActionEvent('thought 2', 'tool_2'),
        createObservationEvent('output 2', 'tool_2'),
      ];
      const result = detector.detect(events);
      expect(result.stuck).toBe(false);
    });
  });
});
