import type { ChatCompletionRequest, LLMClient } from '../llm';
import type { SecretRegistry } from './SecretRegistry';

export const resolveNonNegativeIntOption = (value: unknown, defaultValue: number): number => {
  if (value === undefined) return defaultValue;
  if (typeof value !== 'number' || !Number.isFinite(value)) return defaultValue;
  return Math.max(0, Math.trunc(value));
};

export const clipTextMiddle = (text: string, maxChars: number, clipMarker: string): string => {
  if (maxChars <= 0) return '';
  if (text.length <= maxChars) return text;
  const markerBudget = clipMarker.length + 2;
  if (maxChars < markerBudget) return text.slice(0, maxChars);
  const available = maxChars - markerBudget;
  const headLen = Math.ceil(available / 2);
  const tailLen = Math.floor(available / 2);
  const head = text.slice(0, headLen);
  const tail = tailLen === 0 ? '' : text.slice(-tailLen);
  return `${head}\n${clipMarker}\n${tail}`;
};

export const maskSecrets = (text: string, secrets: SecretRegistry): string => {
  let masked = text;
  const values = secrets
    .getRegisteredValues()
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .sort((a, b) => b.length - a.length);
  for (const value of values) {
    masked = masked.replaceAll(value, '***');
  }
  return masked;
};

export const truncateSummary = (text: string, maxChars: number): string => {
  if (maxChars <= 0) return '';
  if (text.length <= maxChars) return text;
  if (maxChars === 1) return '…';
  return text.slice(0, maxChars - 1) + '…';
};

export const collectStreamedText = async (client: LLMClient, request: ChatCompletionRequest): Promise<string> => {
  let text = '';
  for await (const chunk of client.streamChat(request)) {
    if (chunk.type === 'text') {
      text += chunk.text;
    }
  }
  return text;
};
