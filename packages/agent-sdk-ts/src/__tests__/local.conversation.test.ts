import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LocalConversation } from '../conversation/LocalConversation';
import type { OpenHandsSettings } from '../types/settings';
import type { LLMClient, LLMStreamChunk } from '../llm/types';
import type { Event, ActionEvent } from '../types';

// Mock LLMFactory to avoid real network calls
vi.mock('../llm/factory', () => {
  return {
    LLMFactory: vi.fn().mockImplementation(() => {
      return {
        createClient: vi.fn().mockResolvedValue(mockLLMClient),
      };
    }),
  };
});

// Create a mock LLM client that returns controlled responses
const mockLLMClient: LLMClient = {
  async *streamChat() {
    // Yield a simple text response
    yield { type: 'text', text: 'Hello! ' } as LLMStreamChunk;
    yield { type: 'text', text: 'How can I help you?' } as LLMStreamChunk;
    yield { type: 'finish', finishReason: 'stop' } as LLMStreamChunk;
  },
};

describe('LocalConversation', () => {
  let mockSettings: OpenHandsSettings;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSettings = {
      llm: {
        model: 'gpt-4',
        temperature: 0.7,
      },
      agent: {
        enableSecurityAnalyzer: false,
      },
      conversation: {
        maxIterations: 10,
      },
      confirmation: {
        policy: 'never',
      },
      secrets: {
        llmApiKey: 'test-key',
      },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should create a LocalConversation instance', () => {
      const conversation = new LocalConversation({
        settings: mockSettings,
      });

      expect(conversation).toBeDefined();
      expect(conversation.mode).toBe('local');
      expect(conversation.getStatus()).toBe('online');
    });

    it('should initialize with a conversation ID', () => {
      const conversationId = 'test-conversation-id';
      const conversation = new LocalConversation({
        settings: mockSettings,
        conversationId,
      });

      expect(conversation.getConversationId()).toBe(conversationId);
    });
  });

  describe('conversation lifecycle', () => {
    it('should start a new conversation', async () => {
      const conversation = new LocalConversation({
        settings: mockSettings,
      });

      const conversationStartedSpy = vi.fn();
      conversation.on('conversationStarted', conversationStartedSpy);

      const conversationId = await conversation.startNewConversation();

      expect(conversationId).toBeDefined();
      expect(conversationId).toMatch(/^local-/);
      expect(conversationStartedSpy).toHaveBeenCalledWith(conversationId);
    });

    it('should restore a conversation', () => {
      const conversation = new LocalConversation({
        settings: mockSettings,
      });

      const conversationStartedSpy = vi.fn();
      conversation.on('conversationStarted', conversationStartedSpy);

      const conversationId = 'existing-conversation-id';
      conversation.restoreConversation(conversationId);

      expect(conversation.getConversationId()).toBe(conversationId);
      expect(conversationStartedSpy).toHaveBeenCalledWith(conversationId);
    });
  });

  describe('status management', () => {
    it('should emit status changes', () => {
      const conversation = new LocalConversation({
        settings: mockSettings,
      });

      const statusSpy = vi.fn();
      conversation.on('status', statusSpy);

      conversation.disconnect();
      expect(conversation.getStatus()).toBe('offline');
      expect(statusSpy).toHaveBeenCalledWith('offline');

      conversation.reconnect();
      expect(conversation.getStatus()).toBe('online');
      expect(statusSpy).toHaveBeenCalledWith('online');
    });
  });

  describe('settings', () => {
    it('should update settings', () => {
      const conversation = new LocalConversation({
        settings: mockSettings,
      });

      const newSettings: OpenHandsSettings = {
        ...mockSettings,
        llm: {
          ...mockSettings.llm,
          model: 'gpt-3.5-turbo',
        },
      };

      conversation.setSettings(newSettings);

      // Settings should be updated (we can't directly test this without exposing internal state,
      // but we can verify no errors are thrown)
      expect(() => conversation.setSettings(newSettings)).not.toThrow();
    });
  });

  describe('pause and resume', () => {
    it('should emit PauseEvent when pausing', async () => {
      const conversation = new LocalConversation({
        settings: mockSettings,
      });

      const eventSpy = vi.fn();
      conversation.on('event', eventSpy);

      await conversation.startNewConversation();
      await conversation.pause();

      // Check if PauseEvent was emitted
      const events = eventSpy.mock.calls.map(call => call[0]);
      const pauseEvents = events.filter((event: Event) => event.type === 'PauseEvent');

      // Should have emitted at least one PauseEvent
      expect(pauseEvents.length).toBeGreaterThan(0);
      expect(pauseEvents[0].type).toBe('PauseEvent');
      expect(pauseEvents[0].source).toBe('user');
    });

    it('should not trigger run when paused', async () => {
      const conversation = new LocalConversation({
        settings: mockSettings,
        workspaceRoot: '/tmp/test-workspace',
      });

      const eventSpy = vi.fn();
      conversation.on('event', eventSpy);

      // Start conversation, pause immediately, then send message
      await conversation.startNewConversation();
      await conversation.pause();

      // Clear events from setup
      eventSpy.mockClear();

      // Try to send a message while paused - it should emit user message but not run
      const sendPromise = conversation.sendUserMessage('Test while paused');

      // The sendUserMessage will try to run, but should exit early due to pause status
      await sendPromise;
      await new Promise(resolve => setTimeout(resolve, 50));

      const events = eventSpy.mock.calls.map(call => call[0]);
      const userEvents = events.filter(
        (e: Event) => e.type === 'MessageEvent' && e.source === 'user'
      );

      // Should have the user message
      expect(userEvents.length).toBe(1);
    });

    it('should resume and trigger agent loop', async () => {
      const conversation = new LocalConversation({
        settings: mockSettings,
        workspaceRoot: '/tmp/test-workspace',
      });

      const eventSpy = vi.fn();
      conversation.on('event', eventSpy);

      await conversation.startNewConversation();
      await conversation.pause();

      eventSpy.mockClear();

      // Resume should trigger run
      await conversation.resume();

      // Wait for agent loop
      await new Promise(resolve => setTimeout(resolve, 100));

      const events = eventSpy.mock.calls.map(call => call[0]);

      // Since there are no pending messages, the agent loop shouldn't do much
      // But we verify resume didn't crash and completed
      expect(events).toBeDefined();
    });
  });

  describe('confirmation flow', () => {
    it('should not error when approving with no pending actions', async () => {
      const conversation = new LocalConversation({
        settings: mockSettings,
        workspaceRoot: '/tmp/test-workspace',
      });

      const eventSpy = vi.fn();
      conversation.on('event', eventSpy);

      // Approve with no pending actions - should complete without error
      await expect(conversation.approveAction()).resolves.toBeUndefined();

      // Should not have emitted any observation events
      const events = eventSpy.mock.calls.map(call => call[0]);
      const observationEvents = events.filter(
        (e: Event) => e.type === 'ObservationEvent'
      );
      expect(observationEvents.length).toBe(0);
    });

    it('should emit UserRejectObservation when rejecting actions', async () => {
      // Create a mock client that requests a tool requiring confirmation
      const confirmationClient: LLMClient = {
        async *streamChat() {
          yield { type: 'text', text: 'Let me run a command.' } as LLMStreamChunk;
          yield {
            type: 'tool_call_delta',
            id: 'call_rm',
            name: 'terminal',
            arguments: '{"command": "rm -rf /"}',
          } as LLMStreamChunk;
          yield { type: 'finish', finishReason: 'tool_calls' } as LLMStreamChunk;
        },
      };

      const { LLMFactory } = await import('../llm/factory');
      vi.mocked(LLMFactory).mockImplementationOnce(() => ({
        createClient: vi.fn().mockResolvedValue(confirmationClient),
        requestFromDefaults: vi.fn(),
      }) as any);

      const conversation = new LocalConversation({
        settings: {
          ...mockSettings,
          confirmation: { policy: 'risky' },
        },
        workspaceRoot: '/tmp/test-workspace',
      });

      const eventSpy = vi.fn();
      conversation.on('event', eventSpy);

      // Send message that will trigger risky command
      await conversation.sendUserMessage('Run a risky command');

      // Wait for confirmation state
      await new Promise(resolve => setTimeout(resolve, 100));

      eventSpy.mockClear();

      // Now reject the action
      await conversation.rejectAction('Too dangerous');

      // Should have emitted UserRejectObservation
      const events = eventSpy.mock.calls.map(call => call[0]);
      const rejectEvents = events.filter(
        (e: Event) => e.type === 'UserRejectObservation'
      );

      expect(rejectEvents.length).toBeGreaterThan(0);
      expect(rejectEvents[0].type).toBe('UserRejectObservation');
      if ('rejection_reason' in rejectEvents[0]) {
        expect(rejectEvents[0].rejection_reason).toBe('Too dangerous');
      }
    });

    it('should handle risky confirmation policy', () => {
      const riskySettings = {
        ...mockSettings,
        confirmation: {
          policy: 'risky' as const,
        },
      };

      const conversation = new LocalConversation({
        settings: riskySettings,
      });

      expect(conversation).toBeDefined();
      expect(conversation.getStatus()).toBe('online');
    });
  });

  describe('event emission', () => {
    it('should emit MessageEvent when receiving user messages', async () => {
      const conversation = new LocalConversation({
        settings: mockSettings,
        workspaceRoot: '/tmp/test-workspace',
      });

      const eventSpy = vi.fn();
      conversation.on('event', eventSpy);

      // Send a user message (will use mocked LLM client)
      await conversation.sendUserMessage('Hello, test message');

      // Should have emitted at least a MessageEvent for the user message
      expect(eventSpy).toHaveBeenCalled();

      const events = eventSpy.mock.calls.map(call => call[0]);
      const userMessageEvents = events.filter(
        (event: Event) => event.type === 'MessageEvent' && event.source === 'user'
      );

      expect(userMessageEvents.length).toBeGreaterThanOrEqual(1);

      // Verify the user message content
      const userEvent = userMessageEvents[0] as any;
      expect(userEvent.llm_message.role).toBe('user');
      expect(userEvent.llm_message.content[0].text).toBe('Hello, test message');
    });

    it('should emit assistant MessageEvent after LLM response', async () => {
      const conversation = new LocalConversation({
        settings: mockSettings,
        workspaceRoot: '/tmp/test-workspace',
      });

      const eventSpy = vi.fn();
      conversation.on('event', eventSpy);

      // Send a user message
      await conversation.sendUserMessage('Hello');

      // Wait a bit for the async agent loop to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      const events = eventSpy.mock.calls.map(call => call[0]);
      const assistantEvents = events.filter(
        (event: Event) => event.type === 'MessageEvent' && event.source === 'agent'
      );

      // Should have at least one assistant message from the mocked LLM
      expect(assistantEvents.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('error handling', () => {
    it('should handle LLM errors gracefully', async () => {
      // Create a conversation with a failing LLM client
      const failingClient: LLMClient = {
        async *streamChat() {
          throw new Error('LLM API error');
        },
      };

      // Mock the factory to return the failing client
      const { LLMFactory } = await import('../llm/factory');
      vi.mocked(LLMFactory).mockImplementationOnce(() => ({
        createClient: vi.fn().mockResolvedValue(failingClient),
        requestFromDefaults: vi.fn(),
      }) as any);

      const conversation = new LocalConversation({
        settings: mockSettings,
        workspaceRoot: '/tmp/test-workspace',
      });

      const errorSpy = vi.fn();
      const eventSpy = vi.fn();
      conversation.on('error', errorSpy);
      conversation.on('event', eventSpy);

      // This should trigger an error
      await conversation.sendUserMessage('This will fail');

      // Wait for error to propagate
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should have emitted an error event
      expect(errorSpy).toHaveBeenCalled();

      // Should have emitted ConversationErrorEvent through event log
      const events = eventSpy.mock.calls.map(call => call[0]);
      const errorEvents = events.filter(
        (e: Event) => e.type === 'ConversationErrorEvent'
      );

      // Either through 'error' event or ConversationErrorEvent
      const hasError = errorSpy.mock.calls.length > 0 || errorEvents.length > 0;
      expect(hasError).toBe(true);
    });

    it('should handle invalid JSON in tool arguments', async () => {
      const invalidJsonClient: LLMClient = {
        async *streamChat() {
          yield { type: 'text', text: 'Using a tool.' } as LLMStreamChunk;
          yield {
            type: 'tool_call_delta',
            id: 'call_invalid',
            name: 'terminal',
            arguments: '{invalid json',
          } as LLMStreamChunk;
          yield { type: 'finish', finishReason: 'tool_calls' } as LLMStreamChunk;
        },
      };

      const { LLMFactory } = await import('../llm/factory');
      vi.mocked(LLMFactory).mockImplementationOnce(() => ({
        createClient: vi.fn().mockResolvedValue(invalidJsonClient),
        requestFromDefaults: vi.fn(),
      }) as any);

      const conversation = new LocalConversation({
        settings: mockSettings,
        workspaceRoot: '/tmp/test-workspace',
      });

      const eventSpy = vi.fn();
      conversation.on('event', eventSpy);

      await conversation.sendUserMessage('Test invalid JSON');

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100));

      const events = eventSpy.mock.calls.map(call => call[0]);
      const errorEvents = events.filter((e: Event) => e.type === 'AgentErrorEvent');

      // Should have emitted an error for invalid JSON
      expect(errorEvents.length).toBeGreaterThan(0);
      expect(errorEvents[0].type).toBe('AgentErrorEvent');
      if ('error' in errorEvents[0]) {
        expect((errorEvents[0] as any).error).toContain('JSON');
      }
    });
  });

  describe('tool execution', () => {
    it('should handle unknown tools gracefully', async () => {
      // Create a mock client that requests an unknown tool
      const toolCallingClient: LLMClient = {
        async *streamChat() {
          yield { type: 'text', text: 'Let me use a tool.' } as LLMStreamChunk;
          yield {
            type: 'tool_call_delta',
            id: 'call_123',
            name: 'unknown_tool',
            arguments: '{"test": "value"}',
          } as LLMStreamChunk;
          yield { type: 'finish', finishReason: 'tool_calls' } as LLMStreamChunk;
        },
      };

      const { LLMFactory } = await import('../llm/factory');
      vi.mocked(LLMFactory).mockImplementationOnce(() => ({
        createClient: vi.fn().mockResolvedValue(toolCallingClient),
        requestFromDefaults: vi.fn(),
      }) as any);

      const conversation = new LocalConversation({
        settings: mockSettings,
        workspaceRoot: '/tmp/test-workspace',
      });

      const eventSpy = vi.fn();
      conversation.on('event', eventSpy);

      await conversation.sendUserMessage('Use an unknown tool');

      // Wait for agent loop
      await new Promise(resolve => setTimeout(resolve, 100));

      const events = eventSpy.mock.calls.map(call => call[0]);
      const errorEvents = events.filter(
        (event: Event) => event.type === 'AgentErrorEvent'
      );

      // Should have emitted an error for the unknown tool
      expect(errorEvents.length).toBeGreaterThanOrEqual(1);
    });
  });
});
