import type { Message } from '../types';

// OpenAI-compatible providers require that assistant tool_calls are followed by tool messages for each tool_call_id.
// If we encounter conversation-level tool execution failures, we intentionally do not emit tool messages; sanitize
// orphan tool_calls from the next request to avoid poisoning the conversation history.
export function sanitizeChatMessages(messages: Message[]): Message[] {
  const sanitized: Array<Message | null> = [];

  let pendingAssistantIndex: number | null = null;
  let pendingAssistantMessage: Message | null = null;
  let pendingToolResponseIds = new Set<string>();
  let pendingToolMessageIndices: number[] = [];

  const hasMeaningfulAssistantContent = (message: Message): boolean => {
    if (message.responses_reasoning_item) return true;
    if (typeof message.reasoning_content === 'string' && message.reasoning_content.trim().length > 0) return true;
    return message.content.some((part) => (part.type === 'text' ? part.text.trim().length > 0 : true));
  };

  const flushPendingAssistant = () => {
    if (pendingAssistantIndex === null || !pendingAssistantMessage) return;

    const originalToolCalls = pendingAssistantMessage.tool_calls ?? [];
    const matchingToolCalls = originalToolCalls.filter((call) => pendingToolResponseIds.has(call.id));

    if (matchingToolCalls.length === 0) {
      const withoutToolCalls: Message = { ...pendingAssistantMessage, tool_calls: undefined };
      const keepAssistant = hasMeaningfulAssistantContent(withoutToolCalls);
      sanitized[pendingAssistantIndex] = keepAssistant ? withoutToolCalls : null;
      for (const idx of pendingToolMessageIndices) sanitized[idx] = null;
    } else {
      const keptToolIds = new Set<string>(matchingToolCalls.map((call) => call.id));
      sanitized[pendingAssistantIndex] = { ...pendingAssistantMessage, tool_calls: matchingToolCalls };
      for (const idx of pendingToolMessageIndices) {
        const message = sanitized[idx];
        if (!message || message.role !== 'tool') continue;
        const toolCallId = message.tool_call_id;
        if (typeof toolCallId !== 'string' || !keptToolIds.has(toolCallId)) {
          sanitized[idx] = null;
        }
      }
    }

    pendingAssistantIndex = null;
    pendingAssistantMessage = null;
    pendingToolResponseIds = new Set<string>();
    pendingToolMessageIndices = [];
  };

  for (const message of messages) {
    if (message.role === 'assistant') {
      flushPendingAssistant();

      if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
        pendingAssistantIndex = sanitized.length;
        pendingAssistantMessage = message;
        pendingToolResponseIds = new Set<string>();
      }

      sanitized.push(message);
      continue;
    }

    if (pendingAssistantMessage && message.role === 'tool' && typeof message.tool_call_id === 'string') {
      pendingToolResponseIds.add(message.tool_call_id);
      pendingToolMessageIndices.push(sanitized.length);
      sanitized.push(message);
      continue;
    }

    if (message.role === 'tool') {
      // Drop orphan tool messages (they can occur after condensation filters older assistant tool_calls).
      continue;
    }

    sanitized.push(message);
  }

  flushPendingAssistant();

  return sanitized.filter((message): message is Message => Boolean(message));
}

