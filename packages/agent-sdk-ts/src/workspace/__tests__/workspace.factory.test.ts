import { describe, expect, it } from 'vitest';
import { LocalWorkspace, Workspace } from '..';

describe('Workspace() factory', () => {
  it('creates a local workspace by default', () => {
    const ws = Workspace();
    expect(ws.kind).toBe('local');
    expect(ws).toBeInstanceOf(LocalWorkspace);
  });

  it('rejects remote workspaces until RemoteWorkspace is implemented', () => {
    expect(() => Workspace({ kind: 'remote', serverUrl: 'http://example.com' })).toThrowError(/not implemented/i);
  });
});
