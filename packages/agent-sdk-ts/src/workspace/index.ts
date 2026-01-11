import type { BaseWorkspace } from './BaseWorkspace';
import { LocalWorkspace } from './LocalWorkspace';
import { RemoteWorkspace } from './RemoteWorkspace';

export * from './BaseWorkspace';
export * from './types';
export * from './LocalWorkspace';
export * from './RemoteWorkspace';

export type WorkspaceFactoryOptions =
  | { kind?: 'local'; root?: string }
  | {
    kind: 'remote';
    serverUrl: string;
    apiKey?: string;
    workingDir?: string;
    workspaceRoot?: string;
    runtimeApiUrl?: string;
    runtimeApiKey?: string;
    runtimeId?: string;
  };

export function Workspace(options?: WorkspaceFactoryOptions): BaseWorkspace {
  if (!options || options.kind !== 'remote') {
    return new LocalWorkspace(options?.root);
  }

  const workingDir = options.workingDir ?? options.workspaceRoot;
  return new RemoteWorkspace({
    host: options.serverUrl,
    apiKey: options.apiKey,
    workingDir,
    runtimeApiUrl: options.runtimeApiUrl,
    runtimeApiKey: options.runtimeApiKey,
    runtimeId: options.runtimeId,
  });
}
