import type { AgentErrorEvent, MessageEvent, ToolCall } from '../types';

export interface LlmConvertibleEvent {
  toLlmMessage(): MessageEvent;
}

export interface ToolCallErrorEvent extends AgentErrorEvent, LlmConvertibleEvent {}

export const createToolCallErrorEvent = (toolCall: ToolCall, error: string): ToolCallErrorEvent => {
  const message = error ?? 'Unknown tool error';
  const toolName = toolCall.function.name;
  const toolCallId = toolCall.id;

  return {
    kind: 'AgentErrorEvent',
    source: 'agent',
    error: message,
    tool_name: toolName,
    tool_call_id: toolCallId,
    toLlmMessage(): MessageEvent {
      return {
        kind: 'MessageEvent',
        source: 'environment',
        llm_message: {
          role: 'tool',
          tool_call_id: toolCallId,
          name: toolName,
          content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
        },
      };
    },
  };
};
