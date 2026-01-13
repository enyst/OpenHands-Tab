import * as vscode from 'vscode';
import { maskSecretsInText } from '../shared/maskSecrets';
import type { SecretRegistry } from '@openhands/agent-sdk-ts';

function truncateEncryptedContentForDisplay(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 12) return value;
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

export interface DebugJsonOutputChannel {
  /** Log JSON data with a category badge and pretty formatting */
  logJson(category: string, data: unknown): void;
  /** Log a simple message line */
  log(message: string): void;
  /** Show the channel in the output panel */
  show(): void;
  /** Check if the channel is enabled (dev/test mode only) */
  isEnabled(): boolean;
  /** Dispose of the channel */
  dispose(): void;
}

export interface CreateDebugJsonOutputChannelOptions {
  context: vscode.ExtensionContext;
  secretRegistry?: SecretRegistry;
}

/**
 * Create a debug-only JSON output channel for development and testing.
 * In production mode, returns a no-op implementation.
 */
export function createDebugJsonOutputChannel(
  options: CreateDebugJsonOutputChannelOptions
): DebugJsonOutputChannel {
  const { context, secretRegistry } = options;

  // Only enable in Development or Test modes, or if devBridge setting is enabled
  const mode = context.extensionMode;
  const extensionMode = vscode.ExtensionMode;
  const isDevOrTest =
    (extensionMode?.Development !== undefined &&
      (mode === extensionMode.Development || mode === extensionMode.Test)) ||
    false;
  const enableFromSetting = !!vscode.workspace.getConfiguration().get<boolean>('openhands.devBridge.enabled');
  const enabled = isDevOrTest || enableFromSetting;

  if (!enabled) {
    // Return no-op implementation for production
    return {
      logJson: () => { /* no-op in production */ },
      log: () => { /* no-op in production */ },
      show: () => { /* no-op in production */ },
      isEnabled: () => false,
      dispose: () => { /* no-op in production */ },
    };
  }

  // Create the debug output channel
  let channel: vscode.OutputChannel | undefined;
  try {
    channel = vscode.window.createOutputChannel('OpenHands-DEBUG');
    context.subscriptions.push(channel);
  } catch (err) {
    console.warn('[OpenHands-DEBUG] Failed to create output channel:', err);
    return {
      logJson: () => { /* channel creation failed */ },
      log: () => { /* channel creation failed */ },
      show: () => { /* channel creation failed */ },
      isEnabled: () => false,
      dispose: () => { /* channel creation failed */ },
    };
  }

  const maskSecrets = (text: string): string => {
    return maskSecretsInText(text, secretRegistry);
  };

  const formatTimestamp = (): string => {
    const now = new Date();
    return now.toISOString().replace('T', ' ').replace('Z', '');
  };

  const formatJsonPretty = (data: unknown): string => {
    try {
      const jsonString = JSON.stringify(data, (key: string, value: unknown) => {
        if (key === 'encrypted_content' && typeof value === 'string') {
          return truncateEncryptedContentForDisplay(value);
        }
        return value;
      }, 2);
      return maskSecrets(jsonString);
    } catch (e) {
      return `<failed to stringify: ${String(e)}>`;
    }
  };

  return {
    logJson(category: string, data: unknown): void {
      if (!channel) return;
      const timestamp = formatTimestamp();
      const header = `[${timestamp}] [${category}]`;
      const separator = '─'.repeat(60);
      
      channel.appendLine(separator);
      channel.appendLine(header);
      channel.appendLine(formatJsonPretty(data));
      channel.appendLine('');
    },

    log(message: string): void {
      if (!channel) return;
      const timestamp = formatTimestamp();
      channel.appendLine(`[${timestamp}] ${maskSecrets(message)}`);
    },

    show(): void {
      channel?.show(true);
    },

    isEnabled(): boolean {
      return enabled && !!channel;
    },

    dispose(): void {
      channel?.dispose();
      channel = undefined;
    },
  };
}
