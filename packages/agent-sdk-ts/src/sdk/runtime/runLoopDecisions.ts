import type { LLMProvider } from '../llm';
import { isContextLimitError } from '../llm';

export interface CondensationRetryDecisionArgs {
  attempt: number;
  maxAttempts: number;
  llmProvider?: LLMProvider;
  error: unknown;
}

export interface PreRequestCondensationDecisionArgs {
  attempt: number;
  maxAttempts: number;
  configuredMaxInputTokens: number | null | undefined;
  requestExceedsTokenBudget: boolean;
}

export const shouldRetryWithCondensationAfterError = (args: CondensationRetryDecisionArgs): boolean =>
  args.attempt < args.maxAttempts && isContextLimitError(args.llmProvider, args.error);

export const shouldTryCondensationBeforeRequest = (args: PreRequestCondensationDecisionArgs): boolean =>
  args.attempt < args.maxAttempts
  && typeof args.configuredMaxInputTokens === 'number'
  && args.requestExceedsTokenBudget;

export const resolveCondensationBudget = (
  configuredMaxInputTokens: number | null | undefined,
  fallbackMaxInputTokens: number,
): number =>
  typeof configuredMaxInputTokens === 'number' ? configuredMaxInputTokens : fallbackMaxInputTokens;
