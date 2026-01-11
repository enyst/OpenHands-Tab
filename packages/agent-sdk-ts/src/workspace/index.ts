import { LocalWorkspace } from './LocalWorkspace';
import type { BaseWorkspace } from './BaseWorkspace';

export * from './BaseWorkspace';
export * from './types';
export * from './LocalWorkspace';

export type WorkspaceFactoryOptions =
  | { kind?: 'local'; root?: string }
  | { kind: 'remote'; serverUrl: string; workspaceRoot?: string };

export function Workspace(options?: WorkspaceFactoryOptions): BaseWorkspace {
  if (!options || options.kind === 'local' || options.kind === undefined) {
    return new LocalWorkspace(options?.root);
  }

  // Placeholder for #635 (RemoteWorkspace parity)
  throw new Error('RemoteWorkspace is not implemented yet');
}
