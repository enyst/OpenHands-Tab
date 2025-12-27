import type { BashEvent, Event } from '@openhands/agent-sdk-ts';
import type { LLMConfiguration } from '@openhands/agent-sdk-ts';
import type { OpenHandsSettings, SavedServer } from '../settings/SettingsManager';

/** Default auto-dismiss delay for transient status messages (in milliseconds). */
export const STATUS_MESSAGE_DISMISS_DELAY_MS = 5000;

export type LlmProfileApiKeyStatusInfo = {
  hasKey: boolean;
  hasProfileKey: boolean;
  hasProviderKey: boolean;
  providerKeyName?: string;
};

export type LlmProfileApiKeyStatusOverrides = {
  provider?: string;
  baseUrl?: string;
};

export type HostToWebviewMessage =
  | {
    type: 'status';
    status: string;
    mode: 'local' | 'remote';
    llmProfileLabel?: string | null;
  }
  | { type: 'error'; error: string }
  | { type: 'statusMessage'; level: 'info' | 'warn' | 'error'; message: string; autoDismiss?: boolean; autoDismissDelay?: number }
  | { type: 'llmProfilesUpdated'; profiles: string[]; activeProfileId: string | null }
  | { type: 'llmProfilesListResponse'; requestId: string; ok: true; profiles: string[] }
  | { type: 'llmProfilesListResponse'; requestId: string; ok: false; error: string }
  | { type: 'llmProfileLoadResponse'; requestId: string; ok: true; profileId: string; profile: LLMConfiguration }
  | { type: 'llmProfileLoadResponse'; requestId: string; ok: false; profileId: string; error: string }
  | { type: 'llmProfileSaveResponse'; requestId: string; ok: true; profileId: string }
  | { type: 'llmProfileSaveResponse'; requestId: string; ok: false; profileId: string; error: string }
  | { type: 'llmProfileDeleteResponse'; requestId: string; ok: true; profileId: string }
  | { type: 'llmProfileDeleteResponse'; requestId: string; ok: false; profileId: string; error: string }
  | ({ type: 'llmProfileApiKeyStatusResponse'; requestId: string; ok: true; profileId: string } & LlmProfileApiKeyStatusInfo)
  | { type: 'llmProfileApiKeyStatusResponse'; requestId: string; ok: false; profileId: string; error: string }
  | { type: 'llmProfileApiKeySetResponse'; requestId: string; ok: true; profileId: string }
  | { type: 'llmProfileApiKeySetResponse'; requestId: string; ok: false; profileId: string; error: string }
  | { type: 'serverListUpdated'; servers: SavedServer[]; serverUrl: string }
  | { type: 'halSettings'; hal: OpenHandsSettings['hal'] }
  | {
    type: 'historyList';
    conversations: Array<{
      id: string;
      title?: string;
      firstMessage?: string;
      timestamp: number;
      messageCount?: number;
    }>;
  }
  | { type: 'workspaceFiles'; files: string[] }
  | { type: 'skillsList'; skills: Array<{ label: string; path: string }> }
  | { type: 'toolsList'; tools: Array<{ id: string; label: string; description?: string; isDefault?: boolean }>; enabledToolIds: string[] }
  | { type: 'attachmentsSelected'; attachments: Array<{ uri: string; label: string; sizeBytes?: number }> }
  | { type: 'config'; serverUrl: string | null; mode: 'local' | 'remote' }
  | { type: 'conversationStarted'; conversationId: string }
  | { type: 'event'; seq?: number; event: Event }
  | { type: 'terminalEvent'; event: BashEvent }
  | { type: 'queryRenderedEvents'; requestId: string }
  | { type: 'queryUiState'; requestId: string }
  | { type: 'queryHalState'; requestId: string }
  | { type: 'e2eAction'; action: string; payload?: unknown }
  | { type: 'halTeleportUnavailable'; error: string }
  | { type: 'halTeleportFailed'; error: string }
  | { type: 'halTtsResponse'; requestId: string; ok: true; audioBase64: string; volume: number }
  | { type: 'halTtsResponse'; requestId: string; ok: false; error: string; shouldNotify?: boolean; disabled?: boolean }
  | { type: 'halVoiceConfirmResponse'; requestId: string; ok: true; decision: string }
  | { type: 'halVoiceConfirmResponse'; requestId: string; ok: false; error: string };

export type WebviewToHostMessage =
  | { type: 'webviewReady'; conversationId?: string; lastSeenSeq?: number }
  | { type: 'openSettingsPage' }
  | { type: 'openSettings' }
  | { type: 'requestWorkspaceFiles' }
  | { type: 'requestSkills' }
  | { type: 'requestTools' }
  | { type: 'openSkill'; path: string }
  | { type: 'openWorkspaceFile'; path: string }
  | { type: 'openMarkdownLink'; href: string }
  | { type: 'openWorkspaceDiff'; path: string; oldContent: string; newContent: string; preferGitHead?: boolean }
  | { type: 'requestHistory' }
  | { type: 'restoreConversation'; id: string }
  | { type: 'deleteConversation'; id: string }
  | { type: 'getConfig' }
  | { type: 'setLlmProfileId'; profileId: string | null }
  | { type: 'llmProfilesListRequest'; requestId: string }
  | { type: 'llmProfileLoadRequest'; requestId: string; profileId: string }
  | { type: 'llmProfileSaveRequest'; requestId: string; profileId: string; profile: unknown }
  | { type: 'llmProfileDeleteRequest'; requestId: string; profileId: string }
  | ({ type: 'llmProfileApiKeyStatusRequest'; requestId: string; profileId: string } & LlmProfileApiKeyStatusOverrides)
  | { type: 'llmProfileApiKeySetRequest'; requestId: string; profileId: string; apiKey: string }
  | { type: 'selectServer'; url: string }
  | { type: 'addServer'; server: SavedServer }
  | { type: 'removeServer'; url: string }
  | { type: 'switchToLocal' }
  | { type: 'selectAttachments' }
  | { type: 'openAttachment'; uri: string }
  | { type: 'setEnabledTools'; toolIds: string[] }
  | { type: 'send'; text: string; contextFiles?: string[]; attachments?: string[] }
  | { type: 'halTtsRequest'; requestId: string; conversationId: string; stepIndex: number }
  | { type: 'halVoiceConfirmRequest'; requestId: string; mimeType: string; audioBase64: string }
  | { type: 'command'; command: string; reason?: string }
  | {
    type: 'renderedEventsResponse';
    requestId: string;
    count: number;
    eventTypes: string[];
    events?: Array<{ type: string; marker?: string; toolCallId?: string }>;
  }
  | {
    type: 'uiStateResponse';
    requestId: string;
    input: string;
    showContextPicker: boolean;
    showSkillsPopover: boolean;
    showHistory: boolean;
    workspaceFilesCount: number;
    selectedContextFiles: string[];
    skillsCount: number;
    attachmentsCount: number;
  }
  | {
    type: 'halStateResponse';
    requestId: string;
    enabled: boolean;
    mode: string;
    phase: string;
    eye: string;
    stepIndex: number | null;
    decision: string | null;
    lastError: string | null;
  }
  | { type: 'webviewConsole'; level: string; args: unknown[] }
  | { type: 'webviewError'; message: string; stack?: string }
  | { type: 'webviewNetwork'; phase: string; id: string; method: string; url: string; status?: number; ok?: boolean }
  | { type: 'webviewWebSocket'; phase: string; url: string; code?: number; reason?: string };
