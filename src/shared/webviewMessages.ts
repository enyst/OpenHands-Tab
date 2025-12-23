import type { SavedServer } from '../settings/SettingsManager';

export type WebviewToHostMessage =
  | { type: 'webviewReady'; conversationId?: string; lastSeenSeq?: number }
  | { type: 'openSettingsPage' }
  | { type: 'openSettings' }
  | { type: 'requestWorkspaceFiles' }
  | { type: 'requestSkills' }
  | { type: 'openSkill'; path: string }
  | { type: 'openWorkspaceFile'; path: string }
  | { type: 'openMarkdownLink'; href: string }
  | { type: 'openWorkspaceDiff'; path: string; oldContent: string; newContent: string }
  | { type: 'requestHistory' }
  | { type: 'restoreConversation'; id: string }
  | { type: 'deleteConversation'; id: string }
  | { type: 'getConfig' }
  | { type: 'setLlmProfileId'; profileId: string | null }
  | { type: 'selectServer'; url: string }
  | { type: 'addServer'; server: SavedServer }
  | { type: 'removeServer'; url: string }
  | { type: 'switchToLocal' }
  | { type: 'selectAttachments' }
  | { type: 'openAttachment'; uri: string }
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

