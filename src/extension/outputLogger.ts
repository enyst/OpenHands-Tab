import * as vscode from 'vscode';

export type OutputVerbosity = 'minimal' | 'verbose';

export function normalizeOutputVerbosity(value: unknown): OutputVerbosity {
  return value === 'verbose' ? 'verbose' : 'minimal';
}

export type OutputLogger = {
  show: (preserveFocus?: boolean) => void;
  info: (line: string) => void;
  warn: (line: string) => void;
  error: (line: string) => void;
};

function isProductionExtensionMode(extensionMode: unknown): boolean {
  // VS Code defines: Production=1, Development=2, Test=3.
  const maybeVscode = vscode as unknown as { ExtensionMode?: { Production?: number } };
  const productionValue = typeof maybeVscode.ExtensionMode?.Production === 'number' ? maybeVscode.ExtensionMode.Production : 1;
  if (typeof extensionMode !== 'number') return true;
  return extensionMode === productionValue;
}

export function createOutputLogger(deps: {
  getOutputChannel: () => vscode.OutputChannel | undefined;
  getExtensionMode: () => unknown;
  getVerbosity: () => OutputVerbosity;
}): OutputLogger {
  let didAutoShowOnIssue = false;

  const shouldLogInfo = () => !isProductionExtensionMode(deps.getExtensionMode()) || deps.getVerbosity() === 'verbose';

  const append = (line: string) => {
    const channel = deps.getOutputChannel();
    channel?.appendLine(line);
  };

  const maybeAutoShow = () => {
    if (didAutoShowOnIssue) return;
    if (!isProductionExtensionMode(deps.getExtensionMode())) return;
    if (deps.getVerbosity() === 'verbose') return;
    const channel = deps.getOutputChannel();
    if (!channel) return;
    didAutoShowOnIssue = true;
    try {
      channel.show(true);
    } catch {
      // ignore
    }
  };

  return {
    show: (preserveFocus = true) => {
      const channel = deps.getOutputChannel();
      if (!channel) return;
      channel.show(preserveFocus);
    },
    info: (line) => {
      if (!shouldLogInfo()) return;
      append(line);
    },
    warn: (line) => {
      append(line);
      maybeAutoShow();
    },
    error: (line) => {
      append(line);
      maybeAutoShow();
    },
  };
}
