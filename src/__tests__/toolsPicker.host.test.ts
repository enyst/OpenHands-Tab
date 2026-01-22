import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebviewMessageHandler } from '../webview/host/createWebviewMessageHandler';

describe('Tools picker host messages', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const createHandler = (conversation?: any) => {
    const postMessage = vi.fn(async () => true);
    const handler = createWebviewMessageHandler({
      context: {} as any,
      host: { postMessage },
      getQueuedUserEditNotes: () => [],
      clearQueuedUserEditNotes: () => {},
      getConversation: () => conversation,
      getConversationMode: () => 'local',
      getConversationStoreRoot: () => undefined,
      resolveConversationStoreRoot: async () => '/tmp',
      setWebviewReadyState: () => {},
      setLastKnownLlmLabel: () => {},
      getLastKnownLlmLabel: () => null,
      flushConversationEventBacklog: () => {},
      onRenderedEventsResponse: () => {},
      onUiStateResponse: () => {},
      onHalStateResponse: () => {},
      isDevBridgeEnabled: () => false,
      getOutputChannel: () => undefined,
      fileLog: () => {},
    });

    return { handler, postMessage };
  };

  const createRemoteHandler = (conversation?: any) => {
    const postMessage = vi.fn(async () => true);
    const handler = createWebviewMessageHandler({
      context: {} as any,
      host: { postMessage },
      getQueuedUserEditNotes: () => [],
      clearQueuedUserEditNotes: () => {},
      getConversation: () => conversation,
      getConversationMode: () => 'remote',
      getConversationStoreRoot: () => undefined,
      resolveConversationStoreRoot: async () => '/tmp',
      setWebviewReadyState: () => {},
      setLastKnownLlmLabel: () => {},
      getLastKnownLlmLabel: () => null,
      flushConversationEventBacklog: () => {},
      onRenderedEventsResponse: () => {},
      onUiStateResponse: () => {},
      onHalStateResponse: () => {},
      isDevBridgeEnabled: () => false,
      getOutputChannel: () => undefined,
      fileLog: () => {},
    });

    return { handler, postMessage };
  };

  it('responds to requestTools with the local tools list', async () => {
    const state = { toolNames: ['terminal', 'task_tracker'] };
    const conversation = {
      mode: 'local',
      getToolNames: vi.fn(() => state.toolNames),
      setTools: vi.fn(),
    };

    const { handler, postMessage } = createHandler(conversation);
    await handler({ type: 'requestTools' } as any);

    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'toolsList',
      enabledToolIds: ['terminal', 'task_tracker', 'finish'],
    }));

    const payload = postMessage.mock.calls[0][0] as any;
    expect(payload.tools).toEqual([
      { id: 'terminal', label: 'Terminal', description: 'Execute shell commands in a controlled environment', isDefault: true },
      { id: 'file_editor', label: 'File Editor', description: 'Read, create, and modify files in the workspace', isDefault: true },
      { id: 'task_tracker', label: 'Task Tracker', description: 'Track tasks and progress during the conversation', isDefault: true },
      { id: 'glob', label: 'File Search (Glob)', description: 'Find files by name patterns (e.g., **/*.ts)', isDefault: false },
      { id: 'grep', label: 'Content Search (Grep)', description: 'Search file contents using regex patterns', isDefault: false },
      { id: 'browser', label: 'Web Fetch', description: 'Make HTTP GET/POST requests to fetch web content', isDefault: false },
      { id: 'ask_oracle', label: 'Ask Oracle', description: 'Ask a dedicated oracle LLM for a second opinion (requires openhands.oracle.profileId)', isDefault: false },
      { id: 'finish', label: 'Finish', description: 'Signal that the agent has completed its task (always enabled)', isDefault: true },
    ]);
  });

  it('responds to requestTools in remote mode with the agent-server tools list when available', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(['execute_bash', 'finish', 'file_edit']),
      text: () => Promise.resolve(''),
    } as unknown as Response));
    vi.stubGlobal('fetch', fetchSpy);

    const conversation = {
      serverUrl: 'http://localhost:3000',
      settings: { secrets: { runtimeSessionApiKey: 'test-key-123' } },
    };

    const { handler, postMessage } = createRemoteHandler(conversation);
    await handler({ type: 'requestTools' } as any);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toMatch(/\/api\/tools\/$/);
    expect(fetchSpy.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({
        'X-Session-API-Key': 'test-key-123',
      }),
    }));

    expect(postMessage).toHaveBeenCalledWith({
      type: 'toolsList',
      tools: [
        { id: 'execute_bash', label: 'execute_bash' },
        { id: 'finish', label: 'finish' },
        { id: 'file_edit', label: 'file_edit' },
      ],
      enabledToolIds: ['execute_bash', 'finish', 'file_edit'],
    });
  });

  it('applies setEnabledTools by calling conversation.setTools', async () => {
    const state = { toolNames: ['terminal', 'file_editor', 'task_tracker'] as string[] };
    const conversation = {
      mode: 'local',
      getToolNames: vi.fn(() => state.toolNames),
      setTools: vi.fn((tools: Array<{ name: string }>) => {
        state.toolNames = tools.map((t) => t.name);
      }),
    };

    const { handler, postMessage } = createHandler(conversation);
    await handler({ type: 'setEnabledTools', toolIds: ['file_editor'] } as any);

    expect(conversation.setTools).toHaveBeenCalledTimes(1);
    const arg = (conversation.setTools as any).mock.calls[0][0] as Array<{ name: string }>;
    expect(arg.map((t) => t.name)).toEqual(['file_editor', 'finish']);

    const toolsListPayload = postMessage.mock.calls
      .map((call) => call[0])
      .find((msg) => msg?.type === 'toolsList') as any;

    expect(toolsListPayload.enabledToolIds).toEqual(['file_editor', 'finish']);
  });

  it('does not duplicate finish when provided by the webview', async () => {
    const state = { toolNames: ['terminal', 'file_editor', 'task_tracker'] as string[] };
    const conversation = {
      mode: 'local',
      getToolNames: vi.fn(() => state.toolNames),
      setTools: vi.fn((tools: Array<{ name: string }>) => {
        state.toolNames = tools.map((t) => t.name);
      }),
    };

    const { handler, postMessage } = createHandler(conversation);
    await handler({ type: 'setEnabledTools', toolIds: ['finish', 'file_editor', 'finish'] } as any);

    const arg = (conversation.setTools as any).mock.calls[0][0] as Array<{ name: string }>;
    expect(arg.map((t) => t.name)).toEqual(['finish', 'file_editor']);

    const toolsListPayload = postMessage.mock.calls
      .map((call) => call[0])
      .find((msg) => msg?.type === 'toolsList') as any;

    expect(toolsListPayload.enabledToolIds).toEqual(['finish', 'file_editor']);
  });
});
