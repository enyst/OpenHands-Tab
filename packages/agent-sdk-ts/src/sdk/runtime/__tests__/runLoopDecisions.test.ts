import { describe, expect, it } from 'vitest';
import {
  resolveCondensationBudget,
  shouldRetryWithCondensationAfterError,
  shouldTryCondensationBeforeRequest,
} from '../runLoopDecisions';

describe('runLoopDecisions', () => {
  it('retries with condensation only for context-limit errors within retry budget', () => {
    const contextLimitError = new Error("This model's maximum context length is 128000 tokens");
    const nonContextError = new Error('network timeout');

    expect(shouldRetryWithCondensationAfterError({
      attempt: 0,
      maxAttempts: 1,
      llmProvider: 'openai',
      error: contextLimitError,
    })).toBe(true);

    expect(shouldRetryWithCondensationAfterError({
      attempt: 1,
      maxAttempts: 1,
      llmProvider: 'openai',
      error: contextLimitError,
    })).toBe(false);

    expect(shouldRetryWithCondensationAfterError({
      attempt: 0,
      maxAttempts: 1,
      llmProvider: 'openai',
      error: nonContextError,
    })).toBe(false);
  });

  it('decides pre-request condensation only when budget and attempt conditions are met', () => {
    expect(shouldTryCondensationBeforeRequest({
      attempt: 0,
      maxAttempts: 1,
      requestExceedsTokenBudget: true,
    })).toBe(true);

    expect(shouldTryCondensationBeforeRequest({
      attempt: 1,
      maxAttempts: 1,
      requestExceedsTokenBudget: true,
    })).toBe(false);

    expect(shouldTryCondensationBeforeRequest({
      attempt: 0,
      maxAttempts: 1,
      requestExceedsTokenBudget: false,
    })).toBe(false);
  });

  it('falls back to default condensation budget when maxInputTokens is unset', () => {
    expect(resolveCondensationBudget(8192, 32000)).toBe(8192);
    expect(resolveCondensationBudget(undefined, 32000)).toBe(32000);
    expect(resolveCondensationBudget(null, 32000)).toBe(32000);
  });
});
