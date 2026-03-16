import type { CommandOptions, CommandResult, DirectoryEntry, WorkspaceEncoding } from './types';

export type WorkspaceKind = 'local' | 'remote' | 'apple';
export type RemoteWorkspaceKind = 'remote' | 'apple';
export type ConversationWorkspacePayload = {
  working_dir: string;
};

export interface BaseWorkspace {
  kind: WorkspaceKind;
  root: string;

  allowPath(targetPath: string): void;
  isPathAllowed(targetPath: string): boolean;
  resolvePath(targetPath: string): string;

  readFile(targetPath: string, encoding?: WorkspaceEncoding): Promise<string>;
  readFileBytes(targetPath: string, options?: { maxBytes?: number }): Promise<Buffer>;
  writeFile(targetPath: string, content: string | Buffer): Promise<void>;
  remove(targetPath: string): Promise<void>;
  list(targetPath?: string): Promise<DirectoryEntry[]>;
  ensureDirectory(targetPath: string): Promise<string>;

  runCommand(command: string, options?: CommandOptions): Promise<CommandResult>;

  gitStatus(): Promise<CommandResult>;
  gitDiff(paths?: string[]): Promise<CommandResult>;

  isAlive(): Promise<boolean>;
  pause(): Promise<void>;
  resume(): Promise<void>;

}

export interface AgentServerWorkspace extends BaseWorkspace {
  kind: RemoteWorkspaceKind;
  getServerUrl(): string;
  getAuthHeaders(extra?: Record<string, string>): Record<string, string>;
  getRuntimeSessionApiKey(): string;
  getConversationWorkspacePayload(): ConversationWorkspacePayload;
  setAuth(params: { cloudApiKey?: string; runtimeSessionApiKey?: string }): void;
}

export function isAgentServerWorkspace(
  workspace: unknown,
): workspace is AgentServerWorkspace {
  if (typeof workspace !== 'object' || workspace === null) {
    return false;
  }
  const candidate = workspace as Record<string, unknown>;
  return (
    (candidate.kind === 'remote' || candidate.kind === 'apple') &&
    typeof candidate.root === 'string' &&
    typeof candidate.allowPath === 'function' &&
    typeof candidate.isPathAllowed === 'function' &&
    typeof candidate.resolvePath === 'function' &&
    typeof candidate.readFile === 'function' &&
    typeof candidate.readFileBytes === 'function' &&
    typeof candidate.writeFile === 'function' &&
    typeof candidate.remove === 'function' &&
    typeof candidate.list === 'function' &&
    typeof candidate.ensureDirectory === 'function' &&
    typeof candidate.runCommand === 'function' &&
    typeof candidate.gitStatus === 'function' &&
    typeof candidate.gitDiff === 'function' &&
    typeof candidate.isAlive === 'function' &&
    typeof candidate.pause === 'function' &&
    typeof candidate.resume === 'function' &&
    typeof candidate.getServerUrl === 'function' &&
    typeof candidate.getAuthHeaders === 'function' &&
    typeof candidate.getRuntimeSessionApiKey === 'function' &&
    typeof candidate.getConversationWorkspacePayload === 'function' &&
    typeof candidate.setAuth === 'function'
  );
}
