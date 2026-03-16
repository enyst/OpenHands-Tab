import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpenHandsSettings } from '../../types/settings';
import { RemoteConversation } from '../RemoteConversation';
import { Workspace } from '../../../workspace';

const makeSettings = (): OpenHandsSettings => ({
  llm: {},
  agent: {},
  conversation: {},
  confirmation: {},
  secrets: {},
});

describe('RemoteConversation workspaceRoot', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as unknown as { vscodeWorkspaceRoot?: string }).vscodeWorkspaceRoot;
  });

  it('defaults to process.cwd() and ignores globalThis.vscodeWorkspaceRoot', () => {
    (globalThis as unknown as { vscodeWorkspaceRoot?: string }).vscodeWorkspaceRoot = '/should-not-use';
    vi.spyOn(process, 'cwd').mockReturnValue('/cwd');

    const conversation = new RemoteConversation({
      serverUrl: 'http://localhost:3000',
      settings: makeSettings(),
    });

    expect((conversation as unknown as { workspaceRoot: string }).workspaceRoot).toBe('/cwd');
  });

  it('uses an explicit workspaceRoot when provided (trimmed)', () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/cwd');

    const conversation = new RemoteConversation({
      serverUrl: 'http://localhost:3000',
      settings: makeSettings(),
      workspaceRoot: ' /explicit ',
    });

    expect((conversation as unknown as { workspaceRoot: string }).workspaceRoot).toBe('/explicit');
  });

  it('treats empty workspaceRoot as unset', () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/cwd');

    const conversation = new RemoteConversation({
      serverUrl: 'http://localhost:3000',
      settings: makeSettings(),
      workspaceRoot: '   ',
    });

    expect((conversation as unknown as { workspaceRoot: string }).workspaceRoot).toBe('/cwd');
  });

  it('uses workspace.working_dir when the legacy serverUrl path provides one', () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/cwd');

    const conversation = new RemoteConversation({
      serverUrl: 'http://localhost:3000',
      settings: makeSettings(),
      workspace: { working_dir: ' /payload-root ' },
    });

    expect((conversation as unknown as { workspaceRoot: string }).workspaceRoot).toBe('/payload-root');
  });

  it('uses the injected remote workspace root when provided', () => {
    const conversation = new RemoteConversation({
      settings: makeSettings(),
      workspace: Workspace({
        kind: 'remote',
        serverUrl: 'http://localhost:3000',
        workingDir: '/workspace/injected',
      }),
    });

    expect((conversation as unknown as { workspaceRoot: string }).workspaceRoot).toBe('/workspace/injected');
  });
});
