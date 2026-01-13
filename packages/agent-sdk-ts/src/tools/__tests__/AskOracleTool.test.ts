import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalWorkspace } from '../../workspace';
import { SecretRegistry } from '../../sdk/runtime/SecretRegistry';

const streamChatMock = vi.fn();
const createClientMock = vi.fn(async () => ({ streamChat: streamChatMock }));
const LLMFactoryMock = vi.fn().mockImplementation(() => ({ createClient: createClientMock }));

vi.mock('../../sdk/llm', () => ({
  LLMFactory: LLMFactoryMock,
}));

describe('AskOracleTool', () => {
  beforeEach(() => {
    streamChatMock.mockReset();
    createClientMock.mockClear();
    LLMFactoryMock.mockClear();
  });

  it('validates required question and optional context', async () => {
    const { AskOracleTool } = await import('..');
    const tool = new AskOracleTool();
    expect(() => tool.validate({})).toThrow();
    expect(() => tool.validate({ question: '   ' })).toThrow();
    expect(tool.validate({ question: 'hi' })).toEqual({ question: 'hi' });
    expect(tool.validate({ question: 'hi', context: 'more' })).toEqual({ question: 'hi', context: 'more' });
  });

  it('returns an instructive error when oracle profileId is unset', async () => {
    const { AskOracleTool } = await import('..');
    const tool = new AskOracleTool();
    const workspace = new LocalWorkspace(process.cwd());
    const secrets = new SecretRegistry(undefined, null);

    const result = await tool.execute(tool.validate({ question: 'what now?' }), {
      workspace,
      secrets,
      settings: { llm: {}, agent: {}, conversation: {}, confirmation: {}, secrets: {} } as any,
    });

    expect(result).toContain('openhands.oracle.profileId');
    expect(LLMFactoryMock).not.toHaveBeenCalled();
  });

  it('invokes the configured oracle LLM and returns the answer', async () => {
    const { AskOracleTool } = await import('..');
    const tool = new AskOracleTool();
    const workspace = new LocalWorkspace(process.cwd());
    const secrets = new SecretRegistry(undefined, null);

    let request: any;
    streamChatMock.mockImplementation((req: any) => (async function* () {
      request = req;
      yield { type: 'text', text: 'Hello' };
      yield { type: 'text', text: ' world' };
    })());

    const result = await tool.execute(tool.validate({ question: 'Question?', context: 'Some code' }), {
      workspace,
      secrets,
      settings: {
        llm: {},
        agent: {},
        conversation: {},
        confirmation: {},
        secrets: {},
        oracle: { profileId: 'oracle-profile' },
      } as any,
    });

    expect(LLMFactoryMock).toHaveBeenCalled();
    expect(createClientMock).toHaveBeenCalled();
    expect(request.systemPrompt).toContain('You are an Oracle');
    const userText = request.messages?.[0]?.content?.[0]?.text ?? '';
    expect(userText).toContain('Question?');
    expect(userText).toContain('<environment/context>');
    expect(userText).toContain('Some code');

    expect(result).toEqual('Hello world');
  });

  it('truncates overly large context before sending to the oracle', async () => {
    const { AskOracleTool } = await import('..');
    const tool = new AskOracleTool();
    const workspace = new LocalWorkspace(process.cwd());
    const secrets = new SecretRegistry(undefined, null);

    let request: any;
    streamChatMock.mockImplementation((req: any) => (async function* () {
      request = req;
      yield { type: 'text', text: 'ok' };
    })());

    const huge = 'x'.repeat(250_000);
    await tool.execute(tool.validate({ question: 'Q', context: huge }), {
      workspace,
      secrets,
      settings: {
        llm: {},
        agent: {},
        conversation: {},
        confirmation: {},
        secrets: {},
        oracle: { profileId: 'oracle-profile' },
      } as any,
    });

    const userText = request.messages?.[0]?.content?.[0]?.text ?? '';
    expect(userText.length).toBeLessThan(130_000);
    expect(userText).toContain('<context clipped>');
  });

  it('returns a friendly error when the oracle client cannot be created', async () => {
    const { AskOracleTool } = await import('..');
    const tool = new AskOracleTool();
    const workspace = new LocalWorkspace(process.cwd());
    const secrets = new SecretRegistry(undefined, null);

    createClientMock.mockRejectedValueOnce(new Error('bad profile'));

    const result = await tool.execute(tool.validate({ question: 'Q' }), {
      workspace,
      secrets,
      settings: {
        llm: {},
        agent: {},
        conversation: {},
        confirmation: {},
        secrets: {},
        oracle: { profileId: 'oracle-profile' },
      } as any,
    });

    expect(result).toContain('ask_oracle failed');
  });
});
