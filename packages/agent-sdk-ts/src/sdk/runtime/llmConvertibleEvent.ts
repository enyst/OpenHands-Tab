import type { AgentErrorEvent, LlmConvertibleEvent, MessageEvent, ToolCall } from '../types';

export const createToolCallErrorEvent = (
  toolCall: ToolCall,
  error: string,
): AgentErrorEvent & LlmConvertibleEvent => {
  const message = error ?? 'Unknown tool error';
  const toolName = toolCall.function.name;
  const toolCallId = toolCall.id;

  const llmConvertible: AgentErrorEvent & LlmConvertibleEvent = {
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

  return llmConvertible;
};
