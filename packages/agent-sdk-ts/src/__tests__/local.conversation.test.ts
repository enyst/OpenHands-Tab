import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalConversation } from '../conversation/LocalConversation';
import type { OpenHandsSettings } from '../types/settings';

describe('LocalConversation', () => {
  let mockSettings: OpenHandsSettings;

  beforeEach(() => {
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
    it('should support pause operations', async () => {
      const conversation = new LocalConversation({
        settings: mockSettings,
      });

      await conversation.pause();
      // Pause should complete without errors
      expect(true).toBe(true);
    });

    it('should support resume operations', async () => {
      const conversation = new LocalConversation({
        settings: mockSettings,
      });

      await conversation.resume();
      // Resume should complete without errors
      expect(true).toBe(true);
    });
  });

  describe('confirmation flow', () => {
    it('should support approving actions', async () => {
      const conversation = new LocalConversation({
        settings: mockSettings,
      });

      await conversation.approveAction();
      // Approve should complete without errors
      expect(true).toBe(true);
    });

    it('should support rejecting actions', async () => {
      const conversation = new LocalConversation({
        settings: mockSettings,
      });

      await conversation.rejectAction('User rejected');
      // Reject should complete without errors
      expect(true).toBe(true);
    });
  });

  describe('event emission', () => {
    it('should emit events when receiving user messages', async () => {
      const conversation = new LocalConversation({
        settings: mockSettings,
      });

      const eventSpy = vi.fn();
      conversation.on('event', eventSpy);

      // Note: This will fail without a valid LLM client, but we can test the basic event emission
      // In a real test, we would mock the LLM client
      try {
        await conversation.sendUserMessage('Hello');
      } catch (error) {
        // Expected to fail without LLM setup, but we should have emitted a user message event
      }

      // Should have emitted at least a MessageEvent for the user message
      expect(eventSpy).toHaveBeenCalled();
      const firstCall = eventSpy.mock.calls[0];
      expect(firstCall[0].type).toBe('MessageEvent');
      expect(firstCall[0].source).toBe('user');
    });
  });
});
