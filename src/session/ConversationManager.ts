export class ConversationManager {
  constructor(private storage: { get: (k: string) => string | undefined; set: (k: string, v: string) => void }) {}

  getCurrentConversationId(): string | undefined {
    return this.storage.get('conversation_id');
  }

  setCurrentConversationId(id: string | undefined) {
    if (id) this.storage.set('conversation_id', id);
    else this.storage.set('conversation_id', '');
  }
}
