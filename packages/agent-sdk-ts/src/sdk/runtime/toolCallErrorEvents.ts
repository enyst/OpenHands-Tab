import type { AgentErrorEvent, MessageEvent, ToolCall } from '../types';
import { TOOL_MESSAGE_CLIP_MARKER, TOOL_MESSAGE_MAX_CHARS, truncateToolMessage } from './toolResultTruncation';

const normalizeErrorMessage = (input: string): string => {
  return input.trim().length ? input : 'Unknown tool error';
};

export const truncateError = (input: string, maxChars: number = TOOL_MESSAGE_MAX_CHARS): string => {
  const message = normalizeErrorMessage(input);
  if (maxChars <= 0) return '';
  if (message.length <= maxChars) return message;

  if (maxChars < TOOL_MESSAGE_CLIP_MARKER.length + 2) {
    return message.slice(0, maxChars);
  }
  return truncateToolMessage(message, maxChars);
};

export const createToolCallErrorEvents = (
  toolCall: ToolCall,
  error: string,
): { agentErrorEvent: AgentErrorEvent; toolMessageEvent: MessageEvent } => {
  const rawMessage = normalizeErrorMessage(error);
  const message = truncateToolMessage(rawMessage);
  const toolName = toolCall.function.name;
  const toolCallId = toolCall.id;

  const agentErrorEvent: AgentErrorEvent = {
    kind: 'AgentErrorEvent',
    source: 'agent',
    error: rawMessage,
    tool_name: toolName,
    tool_call_id: toolCallId,
  };

  // IMPORTANT: keep tool message content as raw text to match python agent-sdk behavior.
  // Do NOT JSON-encode here; the LLM expects the same plain text the Python SDK sends.
  const toolMessageEvent: MessageEvent = {
    kind: 'MessageEvent',
    source: 'environment',
    llm_message: {
      role: 'tool',
      tool_call_id: toolCallId,
      name: toolName,
      content: [{ type: 'text', text: message }],
    },
  };

  return { agentErrorEvent, toolMessageEvent };
};
