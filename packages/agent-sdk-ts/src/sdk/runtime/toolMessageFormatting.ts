import type { ToolCall } from '../types';
import { toolResultToLLMText } from '../observations';

export function formatToolMessageText(toolCall: ToolCall, result: unknown): string {
  return toolResultToLLMText(toolCall, result);
}
