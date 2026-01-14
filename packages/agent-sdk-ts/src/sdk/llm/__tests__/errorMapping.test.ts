import { describe, it, expect } from 'vitest';
import { classifyLlmErrorCode } from '../errorMapping';

describe('classifyLlmErrorCode', () => {
  describe('network errors', () => {
    const networkCodes = [
      'ECONNREFUSED',
      'ECONNRESET',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'ENOTFOUND',
      'EAI_AGAIN',
      'ETIMEDOUT',
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_SOCKET',
    ];

    networkCodes.forEach((code) => {
      it(`classifies ${code} as llm_network_error`, () => {
        const error = new Error('Network failure');
        (error as Error & { code: string }).code = code;
        expect(classifyLlmErrorCode({ error })).toBe('llm_network_error');
      });
    });

    it('detects error code in cause', () => {
      const cause = { code: 'ECONNREFUSED' };
      const error = { message: 'fetch failed', cause };
      expect(classifyLlmErrorCode({ error })).toBe('llm_network_error');
    });
  });

  describe('abort/timeout errors', () => {
    it('classifies AbortError by name', () => {
      const error = new Error('Aborted');
      error.name = 'AbortError';
      expect(classifyLlmErrorCode({ error })).toBe('llm_timeout');
    });

    it('classifies error message containing "aborted"', () => {
      const error = new Error('The request was aborted');
      expect(classifyLlmErrorCode({ error })).toBe('llm_timeout');
    });

    it('classifies error message containing "aborterror"', () => {
      const error = new Error('AbortError: operation cancelled');
      expect(classifyLlmErrorCode({ error })).toBe('llm_timeout');
    });
  });

  describe('HTTP status errors from message', () => {
    it('classifies 401 as llm_auth', () => {
      const error = new Error('LLM request failed (401): Unauthorized');
      expect(classifyLlmErrorCode({ error })).toBe('llm_auth');
    });

    it('classifies 403 as llm_auth', () => {
      const error = new Error('Anthropic request failed (403): Forbidden');
      expect(classifyLlmErrorCode({ error })).toBe('llm_auth');
    });

    it('classifies 429 as llm_rate_limit', () => {
      const error = new Error('LLM request failed (429): Too Many Requests');
      expect(classifyLlmErrorCode({ error })).toBe('llm_rate_limit');
    });

    it('classifies 408 as llm_timeout', () => {
      const error = new Error('LLM request failed (408): Request Timeout');
      expect(classifyLlmErrorCode({ error })).toBe('llm_timeout');
    });

    it('classifies 504 as llm_timeout', () => {
      const error = new Error('LLM request failed (504): Gateway Timeout');
      expect(classifyLlmErrorCode({ error })).toBe('llm_timeout');
    });

    it('classifies 500 as llm_service_unavailable', () => {
      const error = new Error('LLM request failed (500): Internal Server Error');
      expect(classifyLlmErrorCode({ error })).toBe('llm_service_unavailable');
    });

    it('classifies 502 as llm_service_unavailable', () => {
      const error = new Error('LLM request failed (502): Bad Gateway');
      expect(classifyLlmErrorCode({ error })).toBe('llm_service_unavailable');
    });

    it('classifies 503 as llm_service_unavailable', () => {
      const error = new Error('LLM request failed (503): Service Unavailable');
      expect(classifyLlmErrorCode({ error })).toBe('llm_service_unavailable');
    });

    it('classifies 400 as llm_bad_request', () => {
      const error = new Error('LLM request failed (400): Bad Request');
      expect(classifyLlmErrorCode({ error })).toBe('llm_bad_request');
    });

    it('classifies 422 as llm_bad_request', () => {
      const error = new Error('LLM request failed (422): Unprocessable Entity');
      expect(classifyLlmErrorCode({ error })).toBe('llm_bad_request');
    });

    it('handles HTTP prefix in status format', () => {
      const error = new Error('LLM request failed (HTTP 400): Bad Request');
      expect(classifyLlmErrorCode({ error })).toBe('llm_bad_request');
    });
  });

  describe('context limit errors', () => {
    it('classifies context limit error for anthropic', () => {
      // Context limit detection is done via isContextLimitError
      // which checks for specific patterns
      const error = new Error('prompt is too long');
      expect(classifyLlmErrorCode({ provider: 'anthropic', error })).toBe('llm_context_limit');
    });

    it('classifies context limit error for openai', () => {
      const error = new Error('maximum context length');
      expect(classifyLlmErrorCode({ provider: 'openai', error })).toBe('llm_context_limit');
    });
  });

  describe('edge cases', () => {
    it('returns undefined for unclassified error', () => {
      const error = new Error('Unknown error');
      expect(classifyLlmErrorCode({ error })).toBe(undefined);
    });

    it('handles string errors', () => {
      const error = 'LLM request failed (500): Server Error';
      expect(classifyLlmErrorCode({ error })).toBe('llm_service_unavailable');
    });

    it('handles non-Error objects', () => {
      const error = { message: 'LLM request failed (429): Rate limited' };
      expect(classifyLlmErrorCode({ error })).toBe('llm_rate_limit');
    });

    it('handles null provider', () => {
      const error = new Error('LLM request failed (400): Bad Request');
      expect(classifyLlmErrorCode({ provider: null, error })).toBe('llm_bad_request');
    });

    it('handles undefined provider', () => {
      const error = new Error('LLM request failed (400): Bad Request');
      expect(classifyLlmErrorCode({ provider: undefined, error })).toBe('llm_bad_request');
    });

    it('handles empty error message', () => {
      const error = new Error('');
      expect(classifyLlmErrorCode({ error })).toBe(undefined);
    });

    it('handles objects that stringify to error-like text', () => {
      const error = { customField: true };
      expect(classifyLlmErrorCode({ error })).toBe(undefined);
    });
  });
});
