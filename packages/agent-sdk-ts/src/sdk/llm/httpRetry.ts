import { setTimeout as delay } from 'node:timers/promises';
import type { RetryOptions } from './types';

export class NonRetryableHttpStatusError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'NonRetryableHttpStatusError';
    this.status = status;
  }
}

export type RequestWithRetryOptions<T> = {
  retry: RetryOptions;
  timeoutSeconds?: number | null;
  defaultTimeoutMs: number;
  request: (signal: AbortSignal) => Promise<Response>;
  parseResponse: (response: Response) => Promise<T>;
  buildStatusError: (status: number, detail: string) => NonRetryableHttpStatusError;
  finalErrorMessage: string;
  readErrorBody?: (response: Response) => Promise<string>;
};

const resolveTimeoutMs = (timeoutSeconds: number | null | undefined, defaultTimeoutMs: number): number =>
  (typeof timeoutSeconds === 'number' && timeoutSeconds > 0 ? timeoutSeconds * 1000 : defaultTimeoutMs);

export async function requestWithRetry<T>(options: RequestWithRetryOptions<T>): Promise<T> {
  let attempt = 0;
  let delayMs = options.retry.baseDelayMs;
  let lastError: Error | undefined;

  while (attempt <= options.retry.maxRetries) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), resolveTimeoutMs(options.timeoutSeconds, options.defaultTimeoutMs));
      let response: Response;
      try {
        response = await options.request(controller.signal);
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        const shouldRetry = options.retry.retryOn(response.status) && attempt < options.retry.maxRetries;
        if (shouldRetry) {
          await delay(delayMs);
          delayMs = Math.min(options.retry.maxDelayMs, delayMs * 2);
          attempt += 1;
          continue;
        }

        const detail = options.readErrorBody
          ? await options.readErrorBody(response)
          : await response.text();
        throw options.buildStatusError(response.status, detail);
      }

      return await options.parseResponse(response);
    } catch (error) {
      if (error instanceof NonRetryableHttpStatusError) {
        throw error;
      }

      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt >= options.retry.maxRetries) {
        break;
      }

      await delay(delayMs);
      delayMs = Math.min(options.retry.maxDelayMs, delayMs * 2);
      attempt += 1;
    }
  }

  throw lastError ?? new Error(options.finalErrorMessage);
}
