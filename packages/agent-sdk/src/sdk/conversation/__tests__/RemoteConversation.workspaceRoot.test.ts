import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpenHandsSettings } from '../../types/settings';
import { RemoteConversation } from '../RemoteConversation';

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
});

