import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../../llm';
import type { OpenHandsSettings } from '../../types/settings';

vi.mock('../createLlmClientFromSettings', async () => {
  const actual = await vi.importActual<any>('../createLlmClientFromSettings');
  return {
    ...actual,
    createLlmClientFromSettings: vi.fn(),
  };
});

class MockLLM implements LLMClient {
  async *streamChat(_request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    void _request;
    yield { type: 'finish' };
  }
}

const baseSettings: OpenHandsSettings = {
  llm: { model: 'test-model' },
  agent: {},
  conversation: { maxIterations: 10 },
  confirmation: { policy: 'never' },
  secrets: {},
};

const createdRoots: string[] = [];

const createWorkspaceRoot = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-llm-cache-'));
  createdRoots.push(root);
  return root;
};

beforeEach(async () => {
  const { createLlmClientFromSettings } = await import('../createLlmClientFromSettings');
  (createLlmClientFromSettings as any).mockReset();
});

afterEach(() => {
  for (const root of createdRoots) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  createdRoots.length = 0;
});

describe('Agent LLM cache reset', () => {
  it('clears LLM caches on setSettings() so the next run re-creates the client', async () => {
    const { createLlmClientFromSettings } = await import('../createLlmClientFromSettings');
    (createLlmClientFromSettings as any)
      .mockResolvedValueOnce(new MockLLM())
      .mockResolvedValueOnce(new MockLLM());

    const { Agent, EventLog } = await import('..');
    const workspaceRoot = createWorkspaceRoot();
    const log = new EventLog();
    const agent = new Agent({ settings: baseSettings, events: log, workspaceRoot });

    await agent.run('hi');
    expect(createLlmClientFromSettings).toHaveBeenCalledTimes(1);

    agent.setSettings({ ...baseSettings, llm: { ...baseSettings.llm, model: 'test-model-2' } });
    await (agent as any).lock.acquire(async () => undefined);
    await agent.run('hi again');
    expect(createLlmClientFromSettings).toHaveBeenCalledTimes(2);
  });

  it('clears LLM caches after llm_init failure so the next run retries client creation', async () => {
    const { createLlmClientFromSettings } = await import('../createLlmClientFromSettings');
    (createLlmClientFromSettings as any)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(new MockLLM());

    const { Agent, EventLog } = await import('..');
    const workspaceRoot = createWorkspaceRoot();
    const log = new EventLog();
    const agent = new Agent({ settings: baseSettings, events: log, workspaceRoot });

    await expect(agent.run('hi')).resolves.toBeUndefined();
    expect(createLlmClientFromSettings).toHaveBeenCalledTimes(1);

    await expect(agent.run('retry')).resolves.toEqual({ role: 'assistant', content: [] });
    expect(createLlmClientFromSettings).toHaveBeenCalledTimes(2);
  });
});
