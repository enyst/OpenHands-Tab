import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpenHandsSettings } from '../types/settings';
import type { RemoteConversationTool, RemoteConversationWorkspace } from './RemoteConversation';
import { RemoteConversation } from './RemoteConversation';
import { saveProfile } from '../llm/profiles';

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

  it('expands profileId into server-supported llm fields without sending profile_id', async () => {
    const connectSpy = vi
      .spyOn(RemoteConversation.prototype as unknown as { connect: () => void }, 'connect')
      .mockImplementation(() => {});
    const fetchSpy = vi.fn((_url: string, init?: RequestInit) => {
      void _url;
      void init;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 'conv-profile' }),
        text: () => Promise.resolve(''),
      } as unknown as Response);
    });
    vi.stubGlobal('fetch', fetchSpy);

    const profilesRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-llm-profiles-'));
    try {
      saveProfile(
        'gpt-5',
        { provider: 'openai', model: 'gpt-5', baseUrl: 'http://profile.example' },
        { rootDir: profilesRoot }
      );

      const settings: OpenHandsSettings = {
        ...baseSettings,
        llm: {
          model: 'settings-model-should-not-win',
          profileId: 'gpt-5',
          baseUrl: 'http://override.example',
        },
      };

      const conversation = new RemoteConversation({
        serverUrl: 'http://localhost:3000',
        settings,
        profileStoreOptions: { rootDir: profilesRoot },
      });

      await conversation.startNewConversation();

      expect(connectSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit | undefined];
      const parsed = JSON.parse(init?.body as string) as { agent: { llm: Record<string, unknown> } };
      expect(parsed.agent.llm.profile_id).toBeUndefined();
      expect(parsed.agent.llm.model).toBe('gpt-5');
      expect(parsed.agent.llm.base_url).toBe('http://profile.example');
    } finally {
      fs.rmSync(profilesRoot, { recursive: true, force: true });
    }
  });

  it('updates active conversation LLM via POST /api/conversations/{id}/llm when settings change', async () => {
    const connectSpy = vi
      .spyOn(RemoteConversation.prototype as unknown as { connect: () => void }, 'connect')
      .mockImplementation(() => {});

    const fetchSpy = vi.fn((url: string, init?: RequestInit) => {
      if (url === 'http://localhost:3000/api/conversations') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: 'conv-switch' }),
          text: () => Promise.resolve(''),
        } as unknown as Response);
      }

      if (url === 'http://localhost:3000/api/conversations/conv-switch/llm') {
        const parsed = JSON.parse(init?.body as string) as { llm: Record<string, unknown> };
        expect(parsed.llm.profile_id).toBeUndefined();
        expect(parsed.llm.model).toBe('gpt-4o');
        expect(parsed.llm.base_url).toBe('http://profile-b.example');
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ success: true }),
          text: () => Promise.resolve(''),
        } as unknown as Response);
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    });
    vi.stubGlobal('fetch', fetchSpy);

    const profilesRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-llm-update-'));
    try {
      saveProfile(
        'profile-a',
        { provider: 'openai', model: 'gpt-5', baseUrl: 'http://profile-a.example' },
        { rootDir: profilesRoot }
      );
      saveProfile(
        'profile-b',
        { provider: 'openai', model: 'gpt-4o', baseUrl: 'http://profile-b.example' },
        { rootDir: profilesRoot }
      );

      const conversation = new RemoteConversation({
        serverUrl: 'http://localhost:3000',
        settings: { ...baseSettings, llm: { profileId: 'profile-a' } },
        profileStoreOptions: { rootDir: profilesRoot },
      });

      await conversation.startNewConversation();
      conversation.setSettings({ ...baseSettings, llm: { profileId: 'profile-b' } });

      await vi.waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      });
      expect(connectSpy).toHaveBeenCalledTimes(1);
    } finally {
      fs.rmSync(profilesRoot, { recursive: true, force: true });
    }
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

  it('sends messages with run=false via HTTP', async () => {
    const connectSpy = vi
      .spyOn(RemoteConversation.prototype as unknown as { connect: () => void }, 'connect')
      .mockImplementation(() => {});

    const fetchSpy = vi.fn((url: string, init?: RequestInit) => {
      if (url === 'http://localhost:3000/api/conversations') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: 'conv-run-false' }),
          text: () => Promise.resolve(''),
        } as unknown as Response);
      }

      if (url === 'http://localhost:3000/api/conversations/conv-run-false/events') {
        const parsed = JSON.parse(init?.body as string) as { run?: unknown; role?: unknown; content?: unknown };
        expect(parsed.run).toBe(false);
        expect(parsed.role).toBe('user');
        expect(Array.isArray(parsed.content)).toBe(true);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({}),
          text: () => Promise.resolve(''),
        } as unknown as Response);
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    });
    vi.stubGlobal('fetch', fetchSpy);

    const conversation = new RemoteConversation({
      serverUrl: 'http://localhost:3000',
      settings: baseSettings,
    });

    await conversation.startNewConversation();
    await conversation.sendUserMessage('Environment note', { run: false });

    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
