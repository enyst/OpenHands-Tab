import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { Agent, EventLog } from '../runtime';
import type { OpenHandsSettings } from '../types/settings';
import { isConversationErrorEvent } from '../types';

const createWorkspaceRoot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'agent-error-detail-'));

const baseSettings: OpenHandsSettings = {
  llm: { provider: 'openai', model: 'gpt-5-mini' },
  agent: {},
  conversation: { maxIterations: 1 },
  confirmation: {},
  secrets: {},
};

describe('ConversationErrorEvent details', () => {
  it('does not include internal LLM context in the error detail by default', async () => {
    const originalOpenAIKey = process.env.OPENAI_API_KEY;
    const originalLlmKey = process.env.LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_API_KEY;

    try {
      const log = new EventLog();
      const agent = new Agent({ settings: baseSettings, events: log, workspaceRoot: createWorkspaceRoot() });
      await agent.run('hi');

      const errorEvent = log.list().find(isConversationErrorEvent);
      expect(errorEvent?.detail).toContain('Missing API key');
      expect(errorEvent?.detail).not.toContain('mode=');
      expect(errorEvent?.detail).not.toContain('llm.');
    } finally {
      if (originalOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalOpenAIKey;
      if (originalLlmKey === undefined) delete process.env.LLM_API_KEY;
      else process.env.LLM_API_KEY = originalLlmKey;
    }
  });

  it('includes internal LLM context in the error detail when agent.debug=true', async () => {
    const originalOpenAIKey = process.env.OPENAI_API_KEY;
    const originalLlmKey = process.env.LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_API_KEY;

    try {
      const log = new EventLog();
      const agent = new Agent({
        settings: { ...baseSettings, agent: { debug: true } },
        events: log,
        workspaceRoot: createWorkspaceRoot(),
      });
      await agent.run('hi');

      const errorEvent = log.list().find(isConversationErrorEvent);
      expect(errorEvent?.detail).toContain('Missing API key');
      expect(errorEvent?.detail).toContain('mode=local');
      expect(errorEvent?.detail).toContain('llm.provider=');
    } finally {
      if (originalOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalOpenAIKey;
      if (originalLlmKey === undefined) delete process.env.LLM_API_KEY;
      else process.env.LLM_API_KEY = originalLlmKey;
    }
  });
});

