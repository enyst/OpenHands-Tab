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
  requestExceedsTokenBudget: boolean;
}

export const shouldRetryWithCondensationAfterError = (args: CondensationRetryDecisionArgs): boolean =>
  args.attempt < args.maxAttempts && isContextLimitError(args.llmProvider, args.error);

export const shouldTryCondensationBeforeRequest = (args: PreRequestCondensationDecisionArgs): boolean =>
  args.attempt < args.maxAttempts
  && args.requestExceedsTokenBudget;

export const resolveCondensationBudget = (
  configuredMaxInputTokens: number | null | undefined,
  fallbackMaxInputTokens: number,
): number =>
  typeof configuredMaxInputTokens === 'number' && Number.isFinite(configuredMaxInputTokens)
    ? configuredMaxInputTokens
    : fallbackMaxInputTokens;
