import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../../llm';
import { Agent, EventLog } from '..';
import type { Event } from '../../types';
import type { ToolDefinition } from '../../types/tools';
import type { OpenHandsSettings } from '../../types/settings';

class MockLLM implements LLMClient {
  constructor(private readonly chunks: LLMStreamChunk[]) {}

  async *streamChat(_request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    void _request;
    for (const chunk of this.chunks) {
      yield chunk;
    }
  }
}

const baseSettings: OpenHandsSettings = {
  llm: { model: 'test-model' },
  agent: {},
  conversation: { maxIterations: 1 },
  confirmation: {},
  secrets: {},
};

const createWorkspaceRoot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'agent-debug-'));

class FailingEventLog extends EventLog {
  private failOnKeys: Set<string>;

  constructor(failOnKeys: string[] = []) {
    super();
    this.failOnKeys = new Set(failOnKeys);
  }

  override push(event: Event): Event {
    // Fail when trying to push ConversationStateUpdateEvent with specific keys
    if (event.kind === 'ConversationStateUpdateEvent' && 'key' in event) {
      const key = (event as { key?: string }).key;
      if (key && this.failOnKeys.has(key)) {
        throw new Error(`Simulated failure for key: ${key}`);
      }
    }
    return super.push(event);
  }
}

describe('Agent debug mode', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  describe('llm_request debug event emission', () => {
    it('silently ignores emission failures when debug is disabled (default)', async () => {
      const log = new FailingEventLog(['llm_request']);
      const llm = new MockLLM([{ type: 'text', text: 'Done' }, { type: 'finish' }]);

      const agent = new Agent({
        settings: baseSettings,
        events: log,
        workspaceRoot: createWorkspaceRoot(),
        llmClient: llm,
      });

      await agent.run('test');

      // Console.warn should not be called
      expect(consoleWarnSpy).not.toHaveBeenCalled();

      // No ConversationErrorEvent should be emitted
      const events = log.list();
      const errorEvents = events.filter((e) => e.kind === 'ConversationErrorEvent');
      expect(errorEvents).toHaveLength(0);
    });

    it('logs warnings and emits error events when debug is enabled', async () => {
      const log = new FailingEventLog(['llm_request']);
      const llm = new MockLLM([{ type: 'text', text: 'Done' }, { type: 'finish' }]);

      const agent = new Agent({
        settings: { ...baseSettings, agent: { debug: true } },
        events: log,
        workspaceRoot: createWorkspaceRoot(),
        llmClient: llm,
      });

      await agent.run('test');

      // Console.warn should be called
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[Agent] Failed to emit llm_request debug event:',
        expect.any(Error),
      );

      // ConversationErrorEvent should be emitted
      const events = log.list();
      const errorEvents = events.filter((e) => e.kind === 'ConversationErrorEvent');
      expect(errorEvents.length).toBeGreaterThan(0);
      expect(errorEvents.some((e) => (e as { detail?: string }).detail?.includes('Debug event emission failed'))).toBe(
        true,
      );
    });
  });

  describe('tool_call_raw debug event emission', () => {
    it('silently ignores emission failures when debug is disabled (default)', async () => {
      const log = new FailingEventLog(['llm_tool_call_raw']);
      const tool: ToolDefinition<Record<string, unknown>, { result: string }> = {
        name: 'test_tool',
        validate: (input) => input,
        execute: async () => ({ result: 'success' }),
      };
      const llm = new MockLLM([
        { type: 'text', text: 'Calling tool' },
        { type: 'tool_call_delta', id: 'call_1', name: 'test_tool', arguments: '{}' },
        { type: 'finish' },
      ]);

      const agent = new Agent({
        settings: baseSettings,
        events: log,
        workspaceRoot: createWorkspaceRoot(),
        llmClient: llm,
        tools: [tool],
      });

      await agent.run('test');

      // Console.warn should not be called
      expect(consoleWarnSpy).not.toHaveBeenCalled();

      // No ConversationErrorEvent should be emitted for debug failures
      const events = log.list();
      const errorEvents = events.filter(
        (e) =>
          e.kind === 'ConversationErrorEvent' &&
          (e as { detail?: string }).detail?.includes('Debug event emission failed'),
      );
      expect(errorEvents).toHaveLength(0);
    });

    it('logs warnings and emits error events when debug is enabled', async () => {
      const log = new FailingEventLog(['llm_tool_call_raw']);
      const tool: ToolDefinition<Record<string, unknown>, { result: string }> = {
        name: 'test_tool',
        validate: (input) => input,
        execute: async () => ({ result: 'success' }),
      };
      const llm = new MockLLM([
        { type: 'text', text: 'Calling tool' },
        { type: 'tool_call_delta', id: 'call_1', name: 'test_tool', arguments: '{}' },
        { type: 'finish' },
      ]);

      const agent = new Agent({
        settings: { ...baseSettings, agent: { debug: true } },
        events: log,
        workspaceRoot: createWorkspaceRoot(),
        llmClient: llm,
        tools: [tool],
      });

      await agent.run('test');

      // Console.warn should be called
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[Agent] Failed to emit tool_call_raw debug event:',
        expect.any(Error),
      );

      // ConversationErrorEvent should be emitted
      const events = log.list();
      const errorEvents = events.filter(
        (e) =>
          e.kind === 'ConversationErrorEvent' &&
          (e as { detail?: string }).detail?.includes('Debug event emission failed for tool call'),
      );
      expect(errorEvents.length).toBeGreaterThan(0);
    });
  });

  describe('normal operation without failures', () => {
    it('emits debug events successfully when debug is disabled', async () => {
      const log = new EventLog();
      const llm = new MockLLM([{ type: 'text', text: 'Done' }, { type: 'finish' }]);

      const agent = new Agent({
        settings: baseSettings,
        events: log,
        workspaceRoot: createWorkspaceRoot(),
        llmClient: llm,
      });

      await agent.run('test');

      // Should have llm_request event
      const events = log.list();
      const stateUpdateEvents = events.filter((e) => e.kind === 'ConversationStateUpdateEvent');
      const llmRequestEvent = stateUpdateEvents.find((e) => (e as { key?: string }).key === 'llm_request');
      expect(llmRequestEvent).toBeDefined();
    });

    it('emits debug events successfully when debug is enabled', async () => {
      const log = new EventLog();
      const llm = new MockLLM([{ type: 'text', text: 'Done' }, { type: 'finish' }]);

      const agent = new Agent({
        settings: { ...baseSettings, agent: { debug: true } },
        events: log,
        workspaceRoot: createWorkspaceRoot(),
        llmClient: llm,
      });

      await agent.run('test');

      // Should have llm_request event
      const events = log.list();
      const stateUpdateEvents = events.filter((e) => e.kind === 'ConversationStateUpdateEvent');
      const llmRequestEvent = stateUpdateEvents.find((e) => (e as { key?: string }).key === 'llm_request');
      expect(llmRequestEvent).toBeDefined();

      // No error events should be emitted
      const errorEvents = events.filter((e) => e.kind === 'ConversationErrorEvent');
      expect(errorEvents).toHaveLength(0);
    });
  });
});
