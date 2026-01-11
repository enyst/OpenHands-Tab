export type WorkspaceEncoding =
  | 'ascii'
  | 'utf8'
  | 'utf-8'
  | 'utf16le'
  | 'ucs2'
  | 'ucs-2'
  | 'base64'
  | 'base64url'
  | 'latin1'
  | 'binary'
  | 'hex';


export interface CommandOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  shell?: string | boolean;
}

export interface CommandResult {
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  timeoutOccurred: boolean;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface FileOperationResult {
  success: boolean;
  path: string;
  error?: string;
}

export type GitChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'unknown';

export interface GitChange {
  path: string;
  status: GitChangeStatus;
  previousPath?: string;
}

