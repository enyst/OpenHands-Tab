import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpenHandsSettings } from '../types/settings';
import type { RemoteConversationTool, RemoteConversationWorkspace } from './RemoteConversation';
import { RemoteConversation } from './RemoteConversation';

const baseSettings: OpenHandsSettings = {
  llm: { model: 'test-model' },
  agent: {},
  conversation: {},
  confirmation: {},
  secrets: {},
};

describe('RemoteConversation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('passes provided tools and workspace through to POST /api/conversations', async () => {
    const connectSpy = vi
      .spyOn(RemoteConversation.prototype as unknown as { connect: () => void }, 'connect')
      .mockImplementation(() => {});
    const fetchSpy = vi.fn((_url: string, init?: RequestInit) => {
      void _url;
      void init;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 'conv-1' }),
        text: () => Promise.resolve(''),
      } as unknown as Response);
    });
    vi.stubGlobal('fetch', fetchSpy);

    const tools: RemoteConversationTool[] = [
      { name: 'glob', params: { pattern: '**/*.ts' } },
      { name: 'terminal' },
    ];
    const workspace: RemoteConversationWorkspace = { kind: 'RemoteWorkspace', base_url: 'http://example.com' };

    const conversation = new RemoteConversation({
      serverUrl: 'http://localhost:3000',
      settings: baseSettings,
      tools,
      workspace,
    });

    await conversation.startNewConversation();

    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit | undefined];
    expect(url).toBe('http://localhost:3000/api/conversations');
    expect(init?.method).toBe('POST');
    expect(typeof init?.body).toBe('string');
    const parsed = JSON.parse(init?.body as string) as { agent: { tools: RemoteConversationTool[] }; workspace: RemoteConversationWorkspace };
    expect(parsed.agent.tools).toEqual(tools);
    expect(parsed.workspace).toEqual(workspace);
  });

  it('uses defaults when tools/workspace are not provided', async () => {
    vi.spyOn(RemoteConversation.prototype as unknown as { connect: () => void }, 'connect').mockImplementation(() => {});
    const fetchSpy = vi.fn((_url: string, init?: RequestInit) => {
      void _url;
      void init;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 'conv-2' }),
        text: () => Promise.resolve(''),
      } as unknown as Response);
    });
    vi.stubGlobal('fetch', fetchSpy);

    const workspaceRoot = '/tmp/example-workspace';
    const conversation = new RemoteConversation({
      serverUrl: 'http://localhost:3000/',
      settings: baseSettings,
      workspaceRoot,
    });

    await conversation.startNewConversation();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit | undefined];
    expect(url).toBe('http://localhost:3000/api/conversations');
    const parsed = JSON.parse(init?.body as string) as { agent: { tools: RemoteConversationTool[] }; workspace: RemoteConversationWorkspace };
    expect(parsed.agent.tools).toEqual([
      { name: 'terminal' },
      { name: 'file_editor' },
      { name: 'task_tracker' },
    ]);
    expect(parsed.workspace).toEqual({ kind: 'LocalWorkspace', working_dir: workspaceRoot });
  });
});
