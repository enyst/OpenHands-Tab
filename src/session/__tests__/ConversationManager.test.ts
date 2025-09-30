import { describe, it, expect } from 'vitest';
import { ConversationManager } from '../ConversationManager';

class MemoryStorage {
  private map = new Map<string, string | undefined>();
  get(k: string) { return this.map.get(k); }
  set(k: string, v: string) { this.map.set(k, v); }
}

describe('ConversationManager', () => {
  it('gets/sets conversation id', () => {
    const storage = new MemoryStorage();
    const cm = new ConversationManager(storage);

    expect(cm.getCurrentConversationId()).toBeUndefined();

    cm.setCurrentConversationId('abc');
    expect(cm.getCurrentConversationId()).toBe('abc');

    cm.setCurrentConversationId(undefined);
    // When undefined, we store empty string per implementation
    expect(storage.get('conversation_id')).toBe('');
    expect(cm.getCurrentConversationId()).toBe('');
  });
});
