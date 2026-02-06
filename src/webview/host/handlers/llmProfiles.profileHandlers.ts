import type * as vscode from 'vscode';
import type { ConversationInstance } from '@openhands/agent-sdk-ts';
import type { SettingsManager } from '../../../settings/SettingsManager';
import { resolveConfiguredLlmLabel } from '../../../shared/llmProfiles';
import { STATUS_MESSAGE_DISMISS_DELAY_MS, type WebviewToHostMessage } from '../../../shared/webviewMessages';
import type { CreateWebviewMessageHandlerDeps, WebviewHost } from '../webviewMessageHandler.types';
import * as llmProfilesStore from '../llmProfilesStore';
import { getProfileApiKeySecretKey, listAvailableLlmProfiles, llmProfileStoreOptions } from './llmProfiles.shared';

export async function handleSetLlmProfileId(args: {
  deps: CreateWebviewMessageHandlerDeps;
  host: WebviewHost;
  settingsMgr: SettingsManager;
  outputChannel: vscode.OutputChannel | undefined;
  conversation: ConversationInstance | undefined;
  postStatusError: (message: string) => void;
  message: Extract<WebviewToHostMessage, { type: 'setLlmProfileId' }>;
}): Promise<void> {
  const profileId = typeof args.message.profileId === 'string' ? args.message.profileId.trim() : '';
  const currentSettings = await args.settingsMgr.get();
  const previousProfileId = currentSettings.llm.profileId || '(none)';
  const debugProfiles = currentSettings.agent?.debug === true;
  const convMode = args.deps.getConversationMode();
  const convStatus = args.conversation?.getStatus() ?? 'offline';
  const convId = args.conversation?.getConversationId?.() || '(no conversation)';

  if (debugProfiles) {
    args.outputChannel?.appendLine('[LLM Profile] ========== SWITCH REQUESTED ==========');
    args.outputChannel?.appendLine(
      `[LLM Profile] Switch requested: ${previousProfileId} -> ${profileId || '(none)'} (mode=${convMode}, status=${convStatus}, id=${convId})`,
    );
    args.outputChannel?.appendLine('[LLM Profile] Current settings.llm: ' + JSON.stringify(currentSettings.llm));
  }

  try {
    if (debugProfiles) {
      args.outputChannel?.appendLine(
        '[LLM Profile] Calling settingsMgr.update({ llm: { profileId: "' + profileId + '" } }, "global")...',
      );
    }
    await args.settingsMgr.update({ llm: { profileId } }, 'global');
    if (debugProfiles) {
      args.outputChannel?.appendLine('[LLM Profile] Settings persisted successfully');
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    args.outputChannel?.appendLine('[LLM Profile] Failed to persist selection: ' + reason);
    args.postStatusError(`Failed to save profile selection: ${reason}`);
    return;
  }

  const updated = await args.settingsMgr.get();
  if (debugProfiles) {
    args.outputChannel?.appendLine('[LLM Profile] Updated settings.llm: ' + JSON.stringify(updated.llm));

    args.outputChannel?.appendLine('[LLM Profile] Applying to conversation...');
    args.outputChannel?.appendLine('[LLM Profile] conversation exists: ' + (args.conversation ? 'yes' : 'no'));
    if (args.conversation) {
      args.outputChannel?.appendLine(
        '[LLM Profile] conversation.setSettings exists: ' + (typeof args.conversation.setSettings === 'function' ? 'yes' : 'no'),
      );
    }
  }

  try {
    args.conversation?.setSettings(updated);
    if (debugProfiles) {
      args.outputChannel?.appendLine('[LLM Profile] Applied to conversation successfully');
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    args.outputChannel?.appendLine('[LLM Profile] Failed to apply to conversation: ' + reason);
  }

  const newLabel = resolveConfiguredLlmLabel(updated);
  const oldLabel = args.deps.getLastKnownLlmLabel();
  if (debugProfiles) {
    args.outputChannel?.appendLine('[LLM Profile] Label: ' + (oldLabel || '(null)') + ' -> ' + (newLabel || '(null)'));
  }
  args.deps.setLastKnownLlmLabel(newLabel);

  const finalStatus = args.conversation?.getStatus() ?? 'offline';
  const finalMode = args.deps.getConversationMode();
  const finalLabel = args.deps.getLastKnownLlmLabel();
  if (debugProfiles) {
    args.outputChannel?.appendLine(
      '[LLM Profile] Posting status message: status=' + finalStatus + ', mode=' + finalMode + ', label=' + (finalLabel || '(null)'),
    );
  }

  void args.host.postMessage({
    type: 'status',
    status: finalStatus,
    mode: finalMode,
    llmProfileLabel: finalLabel,
  });

  const profiles = listAvailableLlmProfiles({ deps: args.deps, outputChannel: args.outputChannel });
  const activeProfileId = updated.llm.profileId ?? null;
  if (debugProfiles) {
    args.outputChannel?.appendLine(
      '[LLM Profile] Posting llmProfilesUpdated: profiles=[' + profiles.join(', ') + '], activeProfileId=' + (activeProfileId || '(null)'),
    );
  }

  void args.host.postMessage({
    type: 'llmProfilesUpdated',
    profiles,
    activeProfileId,
  });

  if (finalMode === 'remote' && finalStatus === 'online') {
    void args.host.postMessage({
      type: 'statusMessage',
      level: 'warn',
      message: 'Remote mode: LLM profile changes apply when you start a new conversation. The current remote conversation will continue using its existing model.',
      autoDismiss: true,
      autoDismissDelay: 8000,
    });
  }

  args.outputChannel?.appendLine(
    `[LLM Profile] Switched: ${previousProfileId} -> ${activeProfileId || '(none)'} (mode=${finalMode}, status=${finalStatus}, label=${finalLabel || '(null)'})`,
  );
  if (debugProfiles) {
    args.outputChannel?.appendLine('[LLM Profile] ========== SWITCH COMPLETE ==========');
  }
}

export function handleLlmProfilesListRequest(args: {
  deps: CreateWebviewMessageHandlerDeps;
  host: WebviewHost;
  outputChannel: vscode.OutputChannel | undefined;
  message: Extract<WebviewToHostMessage, { type: 'llmProfilesListRequest' }>;
}): void {
  const requestId = typeof args.message.requestId === 'string' ? args.message.requestId.trim() : '';
  if (!requestId) return;
  try {
    const profiles = listAvailableLlmProfiles({ deps: args.deps, outputChannel: args.outputChannel });
    void args.host.postMessage({ type: 'llmProfilesListResponse', requestId, ok: true, profiles });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    void args.host.postMessage({ type: 'llmProfilesListResponse', requestId, ok: false, error: reason });
  }
}

export function handleLlmProfileLoadRequest(args: {
  deps: CreateWebviewMessageHandlerDeps;
  host: WebviewHost;
  message: Extract<WebviewToHostMessage, { type: 'llmProfileLoadRequest' }>;
}): void {
  const requestId = typeof args.message.requestId === 'string' ? args.message.requestId.trim() : '';
  const profileId = typeof args.message.profileId === 'string' ? args.message.profileId.trim() : '';
  if (!requestId || !profileId) return;

  try {
    const profile = llmProfilesStore.loadProfile(profileId, llmProfileStoreOptions(args.deps));
    void args.host.postMessage({
      type: 'llmProfileLoadResponse',
      requestId,
      ok: true,
      profileId: profile.profileId,
      profile: profile.config,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    void args.host.postMessage({ type: 'llmProfileLoadResponse', requestId, ok: false, profileId, error: reason });
  }
}

export async function handleLlmProfileSaveRequest(args: {
  deps: CreateWebviewMessageHandlerDeps;
  host: WebviewHost;
  settingsMgr: SettingsManager;
  outputChannel: vscode.OutputChannel | undefined;
  message: Extract<WebviewToHostMessage, { type: 'llmProfileSaveRequest' }>;
}): Promise<void> {
  const requestId = typeof args.message.requestId === 'string' ? args.message.requestId.trim() : '';
  const profileId = typeof args.message.profileId === 'string' ? args.message.profileId.trim() : '';
  if (!requestId || !profileId) return;

  try {
    llmProfilesStore.saveProfile(profileId, args.message.profile, llmProfileStoreOptions(args.deps));
    void args.host.postMessage({ type: 'llmProfileSaveResponse', requestId, ok: true, profileId });

    const updated = await args.settingsMgr.get();
    void args.host.postMessage({
      type: 'llmProfilesUpdated',
      profiles: listAvailableLlmProfiles({ deps: args.deps, outputChannel: args.outputChannel }),
      activeProfileId: updated.llm.profileId ?? null,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    void args.host.postMessage({ type: 'llmProfileSaveResponse', requestId, ok: false, profileId, error: reason });
  }
}

export async function handleLlmProfileDeleteRequest(args: {
  deps: CreateWebviewMessageHandlerDeps;
  host: WebviewHost;
  context: vscode.ExtensionContext;
  settingsMgr: SettingsManager;
  outputChannel: vscode.OutputChannel | undefined;
  conversation: ConversationInstance | undefined;
  message: Extract<WebviewToHostMessage, { type: 'llmProfileDeleteRequest' }>;
}): Promise<void> {
  const requestId = typeof args.message.requestId === 'string' ? args.message.requestId.trim() : '';
  const profileId = typeof args.message.profileId === 'string' ? args.message.profileId.trim() : '';
  if (!requestId || !profileId) return;

  try {
    llmProfilesStore.deleteProfile(profileId, llmProfileStoreOptions(args.deps));
    const key = getProfileApiKeySecretKey(profileId);
    await args.context.secrets.delete(key);
    args.deps.secretRegistry?.set(key, undefined);
    void args.host.postMessage({ type: 'llmProfileDeleteResponse', requestId, ok: true, profileId });

    const currentSettings = await args.settingsMgr.get();
    const currentProfileId = currentSettings.llm.profileId ?? '';
    if (currentProfileId === profileId) {
      await args.settingsMgr.update({ llm: { profileId: '' } }, 'global');
      void args.host.postMessage({
        type: 'statusMessage',
        level: 'error',
        message: `Active LLM profile '${profileId}' was deleted; selection cleared.`,
        autoDismiss: true,
        autoDismissDelay: STATUS_MESSAGE_DISMISS_DELAY_MS,
      });
    } else {
      void args.host.postMessage({
        type: 'statusMessage',
        level: 'info',
        message: `Deleted profile '${profileId}'.`,
        autoDismiss: true,
        autoDismissDelay: STATUS_MESSAGE_DISMISS_DELAY_MS,
      });
    }

    const updated = await args.settingsMgr.get();
    args.deps.setLastKnownLlmLabel(resolveConfiguredLlmLabel(updated));

    void args.host.postMessage({
      type: 'status',
      status: args.conversation?.getStatus() ?? 'offline',
      mode: args.deps.getConversationMode(),
      llmProfileLabel: args.deps.getLastKnownLlmLabel(),
    });

    void args.host.postMessage({
      type: 'llmProfilesUpdated',
      profiles: listAvailableLlmProfiles({ deps: args.deps, outputChannel: args.outputChannel }),
      activeProfileId: updated.llm.profileId ?? null,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    void args.host.postMessage({ type: 'llmProfileDeleteResponse', requestId, ok: false, profileId, error: reason });
  }
}
