import type {
  CommandOptions,
  CommandResult,
  DirectoryEntry,
  FileOperationResult,
  GitChange,
  WorkspaceEncoding,
} from './types';

export type WorkspaceKind = 'local' | 'remote';

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

  copyToWorkspace(sourcePath: string, destinationPath: string): Promise<FileOperationResult>;
  fileUpload(localPath: string, workspacePath: string): Promise<FileOperationResult>;
  fileDownload(workspacePath: string, localPath: string): Promise<FileOperationResult>;

  gitChanges(paths?: string[]): Promise<GitChange[]>;


  runCommand(command: string, options?: CommandOptions): Promise<CommandResult>;

  gitStatus(): Promise<CommandResult>;
  gitDiff(paths?: string[]): Promise<CommandResult>;
}
