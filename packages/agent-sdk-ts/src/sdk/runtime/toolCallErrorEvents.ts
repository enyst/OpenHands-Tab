import type { AgentErrorEvent, MessageEvent, ToolCall } from '../types';

export const truncateError = (input: string, max: number = 4096): string => {
  const suffix = ' (truncated)';
  // Normalize whitespace
  const normalized = (input || 'Unknown tool error').replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  const head = normalized.slice(0, Math.max(0, max - suffix.length));
  return head + suffix;
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
