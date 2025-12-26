import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { SecretRegistry } from '@openhands/agent-sdk-ts';
import { maskSecretsInText } from '../shared/maskSecrets';

export function createDevBridgeLogger(opts: { secretRegistry: SecretRegistry | undefined }) {
  let enabled = false;
  let webviewLogFile: string | undefined;

  const setEnabled = (next: boolean) => {
    enabled = next;
  };

  const isEnabled = () => enabled;

  const initFileLogger = async (context: vscode.ExtensionContext) => {
    try {
      const logDir = context.logUri.fsPath;
      await fs.mkdir(logDir, { recursive: true });
      webviewLogFile = path.join(logDir, 'openhands-webview.log');
    } catch (_err) {
      webviewLogFile = undefined;
    }
  };

  const fileLog = (line: string) => {
    if (!enabled || !webviewLogFile) return;
    const masked = maskSecretsInText(line, opts.secretRegistry);
    const ts = new Date().toISOString();
    fs.appendFile(webviewLogFile, `[${ts}] ${masked}\n`).catch((err: unknown) => {
      console.warn('[OpenHands] Failed to append to webview log', err);
    });
  };

  return { setEnabled, isEnabled, initFileLogger, fileLog };
}

export function createMaskedOutputChannel(
  channel: vscode.OutputChannel,
  secretRegistry: SecretRegistry | undefined
): vscode.OutputChannel {
  return new Proxy(channel, {
    get(target, prop, receiver) {
      if (prop === 'appendLine' && typeof target.appendLine === 'function') {
        return (value: string) => target.appendLine(maskSecretsInText(String(value), secretRegistry));
      }

      const append = (target as unknown as { append?: unknown }).append;
      if (prop === 'append' && typeof append === 'function') {
        return (value: string) =>
          (target as unknown as { append: (text: string) => void }).append(maskSecretsInText(String(value), secretRegistry));
      }

      const replace = (target as unknown as { replace?: unknown }).replace;
      if (prop === 'replace' && typeof replace === 'function') {
        return (value: string) =>
          (target as unknown as { replace: (text: string) => void }).replace(maskSecretsInText(String(value), secretRegistry));
      }

      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value === 'function') return (value as (...args: unknown[]) => unknown).bind(target);
      return value;
    },
  });
}

