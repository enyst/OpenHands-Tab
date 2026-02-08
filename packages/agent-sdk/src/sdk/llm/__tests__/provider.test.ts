import { describe, it, expect } from 'vitest';
import { DEFAULT_PROVIDER_BASE_URLS, detectProviderFromBaseUrl } from '../provider';

describe('provider', () => {
  describe('DEFAULT_PROVIDER_BASE_URLS', () => {
    it('has OpenAI URL', () => {
      expect(DEFAULT_PROVIDER_BASE_URLS.openai).toBe('https://api.openai.com/v1');
    });

    it('has Anthropic URL', () => {
      expect(DEFAULT_PROVIDER_BASE_URLS.anthropic).toBe('https://api.anthropic.com/v1');
    });

    it('has Gemini URL', () => {
      expect(DEFAULT_PROVIDER_BASE_URLS.gemini).toBe('https://generativelanguage.googleapis.com/v1beta');
    });

    it('has OpenRouter URL', () => {
      expect(DEFAULT_PROVIDER_BASE_URLS.openrouter).toBe('https://openrouter.ai/api/v1');
    });

    it('has LiteLLM proxy URL', () => {
      expect(DEFAULT_PROVIDER_BASE_URLS.litellm_proxy).toBe('http://localhost:4000');
    });
  });

  describe('detectProviderFromBaseUrl', () => {
    it('detects anthropic from anthropic.com URL', () => {
      expect(detectProviderFromBaseUrl('https://api.anthropic.com/v1')).toBe('anthropic');
      expect(detectProviderFromBaseUrl('https://ANTHROPIC.COM/api')).toBe('anthropic');
    });

    it('detects openrouter from openrouter.ai URL', () => {
      expect(detectProviderFromBaseUrl('https://openrouter.ai/api/v1')).toBe('openrouter');
      expect(detectProviderFromBaseUrl('https://OPENROUTER.AI/api')).toBe('openrouter');
    });

    it('detects litellm_proxy from litellm URL', () => {
      expect(detectProviderFromBaseUrl('http://localhost:4000/litellm')).toBe('litellm_proxy');
      expect(detectProviderFromBaseUrl('http://my-llm-proxy.internal')).toBe('litellm_proxy');
    });

    it('detects gemini from generativelanguage.googleapis.com URL', () => {
      expect(detectProviderFromBaseUrl('https://generativelanguage.googleapis.com/v1beta')).toBe('gemini');
    });

    it('detects gemini from ai.google.dev URL', () => {
      expect(detectProviderFromBaseUrl('https://ai.google.dev/v1')).toBe('gemini');
    });

    it('defaults to openai for unknown URLs', () => {
      expect(detectProviderFromBaseUrl('https://api.custom.com/v1')).toBe('openai');
      expect(detectProviderFromBaseUrl('http://localhost:8080')).toBe('openai');
    });

    it('defaults to openai for undefined', () => {
      expect(detectProviderFromBaseUrl(undefined)).toBe('openai');
    });

    it('defaults to openai for null', () => {
      expect(detectProviderFromBaseUrl(null)).toBe('openai');
    });

    it('defaults to openai for empty string', () => {
      expect(detectProviderFromBaseUrl('')).toBe('openai');
    });

    it('is case-insensitive', () => {
      expect(detectProviderFromBaseUrl('HTTPS://API.ANTHROPIC.COM/V1')).toBe('anthropic');
      expect(detectProviderFromBaseUrl('https://GENERATIVELANGUAGE.GOOGLEAPIS.COM/v1beta')).toBe('gemini');
    });
  });
});
