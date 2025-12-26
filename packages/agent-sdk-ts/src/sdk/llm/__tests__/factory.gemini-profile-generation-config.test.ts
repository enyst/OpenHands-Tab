import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROVIDER_BASE_URLS, LLMFactory, saveProfile } from '..';
import { SecretRegistry } from '../../runtime/SecretRegistry';

describe('LLMFactory (Gemini): generationConfig from profile', () => {
  it('uses temperature + maxOutputTokens from the profile when not overridden', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sdk-gemini-profile-'));
    const originalFetch = globalThis.fetch;
    try {
      saveProfile(
        'test-gemini-profile',
        {
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          baseUrl: DEFAULT_PROVIDER_BASE_URLS.gemini,
          temperature: 0.42,
          maxOutputTokens: 123,
        },
        { rootDir: dir },
      );

      const secrets = new SecretRegistry();
      secrets.set('GEMINI_API_KEY', 'test-gemini-key');

      const factory = new LLMFactory(
        {
          profileId: 'test-gemini-profile',
          // NOTE: model is required by the type but ignored by LLMFactory when profileId is present.
          model: 'unused',
          usageId: 'test-gemini-client',
        },
        { secrets, preferredApiKeys: 'GEMINI_API_KEY', profileStoreOptions: { rootDir: dir } },
      );
      const client = await factory.createClient();

      let capturedBody: any | null = null;
      const fetchMock = vi.fn(async (_url: string, init?: any) => {
        capturedBody = JSON.parse(init?.body ?? '{}');
        return new Response('data: [DONE]\n\n', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      });
      globalThis.fetch = fetchMock as any;

      for await (const chunk of client.streamChat({
        systemPrompt: 'You are a test.',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      })) {
        if (chunk.type === 'finish') break;
      }

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(capturedBody).toBeTruthy();
      expect(capturedBody.generationConfig).toEqual({ temperature: 0.42, maxOutputTokens: 123 });
    } finally {
      globalThis.fetch = originalFetch;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores generationConfig overrides when profileId is set', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sdk-gemini-profile-'));
    const originalFetch = globalThis.fetch;
    try {
      saveProfile(
        'test-gemini-profile',
        {
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          baseUrl: DEFAULT_PROVIDER_BASE_URLS.gemini,
          temperature: 0.42,
          maxOutputTokens: 123,
        },
        { rootDir: dir },
      );

      const secrets = new SecretRegistry();
      secrets.set('GEMINI_API_KEY', 'test-gemini-key');

      const factory = new LLMFactory(
        {
          profileId: 'test-gemini-profile',
          // NOTE: model is required by the type but ignored by LLMFactory when profileId is present.
          model: 'unused',
          usageId: 'test-gemini-client',
          // Should not override the profile config when using profileId.
          temperature: 0.9,
          maxOutputTokens: 999,
        },
        { secrets, preferredApiKeys: 'GEMINI_API_KEY', profileStoreOptions: { rootDir: dir } },
      );
      const client = await factory.createClient();

      let capturedBody: any | null = null;
      const fetchMock = vi.fn(async (_url: string, init?: any) => {
        capturedBody = JSON.parse(init?.body ?? '{}');
        return new Response('data: [DONE]\n\n', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      });
      globalThis.fetch = fetchMock as any;

      for await (const chunk of client.streamChat({
        systemPrompt: 'You are a test.',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      })) {
        if (chunk.type === 'finish') break;
      }

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(capturedBody).toBeTruthy();
      expect(capturedBody.generationConfig).toEqual({ temperature: 0.42, maxOutputTokens: 123 });
    } finally {
      globalThis.fetch = originalFetch;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
