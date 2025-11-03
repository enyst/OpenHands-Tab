// Mock for vscode module used in unit tests
import { vi } from 'vitest';

export const workspace = {
  getConfiguration: vi.fn(),
};

export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
};

export const window = {
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  createOutputChannel: vi.fn(),
};

export const commands = {
  registerCommand: vi.fn(),
  executeCommand: vi.fn(),
};

export const Uri = {
  file: vi.fn((path: string) => ({ fsPath: path, scheme: 'file' })),
  parse: vi.fn((uri: string) => ({ fsPath: uri, scheme: 'file' })),
};
