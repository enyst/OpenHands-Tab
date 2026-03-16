import type { BaseWorkspace } from './BaseWorkspace';
import { AppleWorkspace } from './AppleWorkspace';
import { LocalWorkspace } from './LocalWorkspace';
import { RemoteWorkspace } from './RemoteWorkspace';

export * from './BaseWorkspace';
export * from './types';
export * from './AppleWorkspace';
export * from './LocalWorkspace';
export * from './RemoteWorkspace';

export type WorkspaceFactoryOptions =
  | { kind?: 'local'; root?: string }
  | {
    kind: 'apple';
    root?: string;
    serverUrl?: string;
    hostPort?: number;
    serverPort?: number;
    serverImage?: string;
    startupCommand?: string[];
    volumes?: Array<{
      hostPath: string;
      containerPath: string;
      readonly?: boolean;
    }>;
    forwardEnv?: string[];
    containerBinary?: string;
    startupTimeoutMs?: number;
    pollIntervalMs?: number;
    httpTimeoutMs?: number;
    cloudApiKey?: string;
    runtimeSessionApiKey?: string;
    runtimeApiUrl?: string;
    runtimeApiKey?: string;
    runtimeId?: string;
  }
  | {
    kind: 'remote';
    serverUrl: string;
    cloudApiKey?: string;
    runtimeSessionApiKey?: string;
    workingDir?: string;
    workspaceRoot?: string;
    runtimeApiUrl?: string;
    runtimeApiKey?: string;
    runtimeId?: string;
  };

export function Workspace(options?: WorkspaceFactoryOptions): BaseWorkspace {
  if (!options || !options.kind || options.kind === 'local') {
    return new LocalWorkspace(options?.root);
  }

  if (options.kind === 'apple') {
    return new AppleWorkspace(options);
  }

  const remoteOptions = options as Extract<WorkspaceFactoryOptions, { kind: 'remote' }>;
  const workingDir = remoteOptions.workingDir ?? remoteOptions.workspaceRoot;
  return new RemoteWorkspace({
    host: remoteOptions.serverUrl,
    cloudApiKey: remoteOptions.cloudApiKey,
    runtimeSessionApiKey: remoteOptions.runtimeSessionApiKey,
    workingDir,
    runtimeApiUrl: remoteOptions.runtimeApiUrl,
    runtimeApiKey: remoteOptions.runtimeApiKey,
    runtimeId: remoteOptions.runtimeId,
  });
}
