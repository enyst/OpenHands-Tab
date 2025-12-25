import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { Agent } from '..';
import { getGeminiClient } from '../geminiClient';
import { SecretRegistry } from '../SecretRegistry';
import type { OpenHandsSettings } from '../../types/settings';

class TrackingSecretRegistry extends SecretRegistry {
  readonly calls: string[] = [];

  async get(name: string): Promise<string | undefined> {
    this.calls.push(name);
    return super.get(name);
  }
}

const workspaceRoots: string[] = [];

const createWorkspaceRoot = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sdk-tool-summarizer-keys-'));
  workspaceRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of workspaceRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('Gemini summarizers prefer GEMINI_API_KEY', () => {
  it('getGeminiClient prefers GEMINI_API_KEY over openhands.llmApiKey', async () => {
    const secrets = new TrackingSecretRegistry();
    secrets.set('openhands.llmApiKey', 'sk-openai');
    secrets.set('GEMINI_API_KEY', 'test-gemini-key');

    await getGeminiClient(secrets, {
      usageId: 'test-gemini-client',
      profileId: 'gemini-flash-summarizer',
    });

    expect(secrets.calls[0]).toBe('GEMINI_API_KEY');
  });

  it('Agent tool summarizer prefers GEMINI_API_KEY over openhands.llmApiKey', async () => {
    const secrets = new TrackingSecretRegistry();
    secrets.set('openhands.llmApiKey', 'sk-openai');
    secrets.set('GEMINI_API_KEY', 'test-gemini-key');

    const settings: OpenHandsSettings = {
      llm: { model: 'test-model' },
      agent: { summarizeToolCalls: true },
      conversation: { maxIterations: 1 },
      confirmation: {},
      secrets: {},
    };

    const agent = new Agent({
      settings,
      workspaceRoot: createWorkspaceRoot(),
      secrets,
    });

    await (agent as any).getToolSummarizerClient();

    expect(secrets.calls[0]).toBe('GEMINI_API_KEY');
  });
});
