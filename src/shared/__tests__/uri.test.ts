import { describe, expect, it } from 'vitest';
import { getFileBackedFsPath, isFileBackedUri } from '../uri';

describe('uri helpers', () => {
  it('treats file and vscode-remote schemes as file-backed', () => {
    expect(isFileBackedUri({ scheme: 'file', fsPath: '/a' } as any)).toBe(true);
    expect(isFileBackedUri({ scheme: 'vscode-remote', fsPath: '/b' } as any)).toBe(true);
  });

  it('does not treat other schemes as file-backed', () => {
    expect(isFileBackedUri({ scheme: 'untitled', fsPath: '/a' } as any)).toBe(false);
    expect(isFileBackedUri({ scheme: 'vscode', fsPath: '/a' } as any)).toBe(false);
    expect(isFileBackedUri(null)).toBe(false);
  });

  it('returns a trimmed fsPath for file-backed URIs', () => {
    expect(getFileBackedFsPath({ scheme: 'file', fsPath: '  /a  ' } as any)).toBe('/a');
    expect(getFileBackedFsPath({ scheme: 'vscode-remote', fsPath: '/b' } as any)).toBe('/b');
  });

  it('returns undefined when there is no usable fsPath', () => {
    expect(getFileBackedFsPath({ scheme: 'file', fsPath: '   ' } as any)).toBeUndefined();
    expect(getFileBackedFsPath({ scheme: 'untitled', fsPath: '/a' } as any)).toBeUndefined();
    expect(getFileBackedFsPath(undefined)).toBeUndefined();
  });
});

