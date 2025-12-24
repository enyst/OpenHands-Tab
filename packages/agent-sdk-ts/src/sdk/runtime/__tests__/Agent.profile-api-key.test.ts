import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';

const makeTempDir = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

describe('Agent profile api key selection', () => {
  it('prefers per-profile key over global key when profileId is set', async () => {
    const tmpHome = makeTempDir('agent-profile-key-');
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;

    try {
      process.env.HOME = tmpHome;
      process.env.USERPROFILE = tmpHome;
      vi.resetModules();

      const [{ saveProfile }, { Agent }, { SecretRegistry }] = await Promise.all([
        import('../../llm'),
        import('../Agent'),
        import('../SecretRegistry'),
      ]);

      saveProfile('p1', {
        provider: 'openai',
        model: 'gpt-5-mini',
        openaiApiMode: 'responses',
        baseUrl: 'http://example.invalid/v1',
      });

      const secrets = new SecretRegistry();
      secrets.set('openhands.llmProfileApiKey.p1', 'sk-profile');

      let authorization: string | undefined;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (_url: unknown, init?: { headers?: unknown }) => {
        const headers = init?.headers as Record<string, string> | undefined;
        authorization = headers?.Authorization ?? headers?.authorization;
        return new Response(
          JSON.stringify({
            output: [
              {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'ok' }],
              },
            ],
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }) as typeof globalThis.fetch;

      try {
        const agent = new Agent({
          workspaceRoot: tmpHome,
          secrets,
          settings: {
            llm: { profileId: 'p1' },
            secrets: { llmApiKey: 'sk-global' },
          } as any,
        });

        const client = await (agent as any).createLlmClientFromSettings();
        for await (const _ of client.streamChat({
          systemPrompt: 'test',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        } as any)) {
          void _;
        }
      } finally {
        globalThis.fetch = originalFetch;
      }

      expect(authorization).toBe('Bearer sk-profile');
    } finally {
      process.env.HOME = originalHome;
      process.env.USERPROFILE = originalUserProfile;
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  it('falls back to global key when profile key is absent', async () => {
    const tmpHome = makeTempDir('agent-profile-key-fallback-');
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;

    try {
      process.env.HOME = tmpHome;
      process.env.USERPROFILE = tmpHome;
      vi.resetModules();

      const [{ saveProfile }, { Agent }, { SecretRegistry }] = await Promise.all([
        import('../../llm'),
        import('../Agent'),
        import('../SecretRegistry'),
      ]);

      saveProfile('p1', {
        provider: 'openai',
        model: 'gpt-5-mini',
        openaiApiMode: 'responses',
        baseUrl: 'http://example.invalid/v1',
      });

      const secrets = new SecretRegistry();

      let authorization: string | undefined;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (_url: unknown, init?: { headers?: unknown }) => {
        const headers = init?.headers as Record<string, string> | undefined;
        authorization = headers?.Authorization ?? headers?.authorization;
        return new Response(
          JSON.stringify({
            output: [
              {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'ok' }],
              },
            ],
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }) as typeof globalThis.fetch;

      try {
        const agent = new Agent({
          workspaceRoot: tmpHome,
          secrets,
          settings: {
            llm: { profileId: 'p1' },
            secrets: { llmApiKey: 'sk-global' },
          } as any,
        });

        const client = await (agent as any).createLlmClientFromSettings();
        for await (const _ of client.streamChat({
          systemPrompt: 'test',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        } as any)) {
          void _;
        }
      } finally {
        globalThis.fetch = originalFetch;
      }

      expect(authorization).toBe('Bearer sk-global');
    } finally {
      process.env.HOME = originalHome;
      process.env.USERPROFILE = originalUserProfile;
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});
