import type { AgentErrorEvent, MessageEvent, ToolCall } from '../types';

export const truncateError = (input: string, max: number = 4096): string => {
  const suffix = ' (truncated)';
  const normalizedRaw = (input ?? '').replace(/\s+/g, ' ').trim();
  const normalized = normalizedRaw.length === 0 ? 'Unknown tool error' : normalizedRaw;
  if (max <= 0) return '';
  if (normalized.length <= max) return normalized;
  const headLen = max - suffix.length;
  if (headLen <= 0) {
    // Not enough room for suffix; hard cap to max without suffix
    return normalized.slice(0, max);
  }
  return normalized.slice(0, headLen) + suffix;
};

export const createToolCallErrorEvents = (
  toolCall: ToolCall,
  error: string,
): { agentErrorEvent: AgentErrorEvent; toolMessageEvent: MessageEvent } => {
  const message = truncateError(error);
  const toolName = toolCall.function.name;
  const toolCallId = toolCall.id;

  const agentErrorEvent: AgentErrorEvent = {
    kind: 'AgentErrorEvent',
    source: 'agent',
    error: message,
    tool_name: toolName,
    tool_call_id: toolCallId,
  };

  const toolMessageEvent: MessageEvent = {
    kind: 'MessageEvent',
    source: 'environment',
    llm_message: {
      role: 'tool',
      tool_call_id: toolCallId,
      name: toolName,
      content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
    },
  };

  return { agentErrorEvent, toolMessageEvent };
};
