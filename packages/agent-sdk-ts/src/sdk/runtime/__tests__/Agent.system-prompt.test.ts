import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../../llm';
import { Agent, EventLog } from '..';
import { AgentContext } from '../..';
import { isSystemPromptEvent } from '../../types';
import type { OpenHandsSettings } from '../../types/settings';

class RecordingLLM implements LLMClient {
  readonly requests: ChatCompletionRequest[] = [];

  async *streamChat(request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    this.requests.push(request);
    yield { type: 'text', text: 'ok' };
    yield { type: 'finish' };
  }
}

const workspaceRoots: string[] = [];
const createWorkspaceRoot = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-system-prompt-'));
  workspaceRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of workspaceRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('Agent system prompt', () => {
  it('emits and uses the full OpenHands system prompt text', async () => {
    const settings: OpenHandsSettings = {
      llm: { model: 'test-model' },
      agent: {},
      conversation: { maxIterations: 1 },
      confirmation: { policy: 'risky' },
      secrets: {},
    };
    const log = new EventLog();
    const llm = new RecordingLLM();

    const agent = new Agent({
      settings,
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
    });

    await agent.run('hi');

    expect(llm.requests).toHaveLength(1);
    const { systemPrompt } = llm.requests[0];

    expect(systemPrompt.startsWith('You are OpenHands agent')).toBe(true);
    expect(systemPrompt).toContain('<ROLE>');
    expect(systemPrompt).toContain('<SECURITY>');
    expect(systemPrompt).toContain('Security Risk Policy');

    const systemPromptEvent = log.list().find(isSystemPromptEvent);
    expect(systemPromptEvent).toBeDefined();
    expect(systemPromptEvent.system_prompt.text).toBe(systemPrompt);
  });

  it('includes the latest AgentContext systemMessageSuffix on each LLM request', async () => {
    const settings: OpenHandsSettings = {
      llm: { model: 'test-model' },
      agent: {},
      conversation: { maxIterations: 3 },
      confirmation: { policy: 'never' },
      secrets: {},
    };
    const log = new EventLog();
    const llm = new RecordingLLM();
    const agentContext = new AgentContext({ systemMessageSuffix: 'Currently opened in the editor: /tmp/first.ts' });

    const agent = new Agent({
      settings,
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
      agentContext,
    });

    await agent.run('hi');
    expect(llm.requests[0]?.systemPrompt).toContain('Currently opened in the editor: /tmp/first.ts');

    agentContext.systemMessageSuffix = 'Currently opened in the editor: /tmp/second.ts';
    await agent.run('hi again');
    expect(llm.requests[1]?.systemPrompt).toContain('Currently opened in the editor: /tmp/second.ts');
    expect(llm.requests[1]?.systemPrompt).not.toContain('Currently opened in the editor: /tmp/first.ts');

    agentContext.systemMessageSuffix = undefined;
    await agent.run('hi again (cleared)');
    expect(llm.requests[2]?.systemPrompt).not.toContain('Currently opened in the editor:');
  });
});
