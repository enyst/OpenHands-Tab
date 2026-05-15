import { describe, it, expect } from 'vitest';
import { LLMSecurityAnalyzer } from '../analyzer';
import type { ActionEvent, Event, SecurityRisk } from '../../types';

const createActionEvent = (risk?: SecurityRisk): ActionEvent => ({
  kind: 'ActionEvent',
  source: 'agent',
  thought: [{ type: 'text', text: 'test thought' }],
  action: { test: true },
  tool_name: 'test_tool',
  tool_call_id: 'call_123',
  tool_call: {
    id: 'call_123',
    type: 'function',
    function: { name: 'test_tool', arguments: '{}' },
  },
  llm_response_id: 'resp_123',
  security_risk: risk,
});

describe('LLMSecurityAnalyzer', () => {
  describe('securityRisk', () => {
    it('returns the security_risk from action event when present', () => {
      const analyzer = new LLMSecurityAnalyzer();
      const action = createActionEvent('HIGH');
      expect(analyzer.securityRisk(action)).toBe('HIGH');
    });

    it('returns UNKNOWN when security_risk is undefined', () => {
      const analyzer = new LLMSecurityAnalyzer();
      const action = createActionEvent(undefined);
      expect(analyzer.securityRisk(action)).toBe('UNKNOWN');
    });

    it('handles LOW risk level', () => {
      const analyzer = new LLMSecurityAnalyzer();
      const action = createActionEvent('LOW');
      expect(analyzer.securityRisk(action)).toBe('LOW');
    });

    it('handles MEDIUM risk level', () => {
      const analyzer = new LLMSecurityAnalyzer();
      const action = createActionEvent('MEDIUM');
      expect(analyzer.securityRisk(action)).toBe('MEDIUM');
    });

    it('treats invalid risk levels as HIGH', () => {
      const analyzer = new LLMSecurityAnalyzer();
      const action = createActionEvent('CRITICAL' as SecurityRisk);
      expect(analyzer.securityRisk(action)).toBe('HIGH');
    });
  });

  describe('analyzeEvent', () => {
    it('returns security risk for ActionEvent', () => {
      const analyzer = new LLMSecurityAnalyzer();
      const action = createActionEvent('HIGH');
      expect(analyzer.analyzeEvent(action)).toBe('HIGH');
    });

    it('returns null for non-ActionEvent', () => {
      const analyzer = new LLMSecurityAnalyzer();
      const messageEvent: Event = {
        kind: 'MessageEvent',
        source: 'user',
        llm_message: {
          role: 'user',
          content: [{ type: 'text', text: 'hello' }],
        },
      };
      expect(analyzer.analyzeEvent(messageEvent)).toBe(null);
    });

    it('returns null for ObservationEvent', () => {
      const analyzer = new LLMSecurityAnalyzer();
      const observationEvent: Event = {
        kind: 'ObservationEvent',
        source: 'environment',
        observation: { output: 'test' },
        tool_name: 'test_tool',
        tool_call_id: 'call_123',
        action_id: 'action_123',
      };
      expect(analyzer.analyzeEvent(observationEvent)).toBe(null);
    });
  });

  describe('analyzePendingActions', () => {
    it('returns array of action/risk pairs', () => {
      const analyzer = new LLMSecurityAnalyzer();
      const actions = [
        createActionEvent('HIGH'),
        createActionEvent('LOW'),
        createActionEvent('MEDIUM'),
      ];
      const results = analyzer.analyzePendingActions(actions);

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({ action: actions[0], risk: 'HIGH' });
      expect(results[1]).toEqual({ action: actions[1], risk: 'LOW' });
      expect(results[2]).toEqual({ action: actions[2], risk: 'MEDIUM' });
    });

    it('returns UNKNOWN for actions without security_risk', () => {
      const analyzer = new LLMSecurityAnalyzer();
      const actions = [createActionEvent(undefined)];
      const results = analyzer.analyzePendingActions(actions);

      expect(results).toHaveLength(1);
      expect(results[0].risk).toBe('UNKNOWN');
    });

    it('returns empty array for empty input', () => {
      const analyzer = new LLMSecurityAnalyzer();
      const results = analyzer.analyzePendingActions([]);
      expect(results).toEqual([]);
    });

    it('returns HIGH risk when securityRisk throws', () => {
      // Create a subclass that throws
      class ThrowingAnalyzer extends LLMSecurityAnalyzer {
        override securityRisk(action: ActionEvent): SecurityRisk {
          throw new Error('Unexpected error');
        }
      }

      const analyzer = new ThrowingAnalyzer();
      const actions = [createActionEvent('LOW')];
      const results = analyzer.analyzePendingActions(actions);

      expect(results).toHaveLength(1);
      expect(results[0].risk).toBe('HIGH');
    });
  });

  describe('kind property', () => {
    it('returns LLMSecurityAnalyzer', () => {
      const analyzer = new LLMSecurityAnalyzer();
      expect(analyzer.kind).toBe('LLMSecurityAnalyzer');
    });
  });
});
