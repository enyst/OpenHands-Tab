import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { ActionEvent, Event } from '@openhands/agent-sdk-ts';
import type { WebviewToHostMessage } from '../../../../shared/webviewMessages';
import type { HalSettingsSnapshot } from '../useHalFlow';
import type { PendingLlmProfilesRequest } from '../llmProfilesRequests';
import type { StatusBannerState } from '../useStatusMessages';
import type { HalDecision, HalStateSnapshot } from '../../../../shared/halTypes';
import type { ConversationTotals } from '../conversationTotals';
import type { WelcomeSecretStatus } from '../welcomePrompts';

export type WebviewPersistedState = {
  conversationId?: string;
  lastSeenSeq?: number;
};

export type ConversationsList = Array<{
  id: string;
  title?: string;
  firstMessage?: string;
  timestamp: number;
  messageCount?: number;
}>;

export type RenderedEvent = { id: number; event: Event };

export type UiStateSnapshot = {
  input: string;
  showContextPicker: boolean;
  showSkillsPopover: boolean;
  showHistory: boolean;
  workspaceFilesCount: number;
  selectedContextFiles: string[];
  skillsCount: number;
  attachmentsCount: number;
  hasWelcomeProviderKey: boolean;
  hasWelcomeGeminiKey: boolean;
  showWelcomeProviderKeyMessage: boolean;
  showWelcomeGeminiKeyMessage: boolean;
};

export type ShowStatusMessage = (
  level: 'info' | 'warn' | 'error',
  message: string,
  options?: { autoDismiss?: boolean; autoDismissDelay?: number }
) => void;

export type HostMessagePayload = {
  type?: string;
  requestId?: string;
  ok?: unknown;
  status?: 'online' | 'offline' | 'connecting';
  serverUrl?: string | null;
  serverLabel?: string;
  mode?: 'local' | 'remote';
  llmProfileLabel?: string | null;
  hasProviderKey?: unknown;
  hasGeminiKey?: unknown;
  profiles?: string[];
  activeProfileId?: string | null;
  profileId?: unknown;
  profile?: unknown;
  hasKey?: unknown;
  hasProfileKey?: unknown;
  providerKeyName?: unknown;
  hal?: Partial<HalSettingsSnapshot> & { [k: string]: unknown };
  event?: unknown;
  seq?: unknown;
  error?: unknown;
  conversationId?: string;
  files?: string[];
  skills?: { label: string; path: string }[];
  tools?: { id: string; label: string }[];
  enabledToolIds?: string[];
  conversations?: ConversationsList;
  servers?: { url: string; label?: string }[];
  attachments?: Array<{ uri: string; label: string; sizeBytes?: number }>;
  level?: unknown;
  message?: unknown;
  autoDismiss?: unknown;
  autoDismissDelay?: unknown;
  action?: unknown;
  payload?: unknown;
};

export type HostMessageHandler = (payload: HostMessagePayload) => void;
export type HostMessageHandlerRegistry = Partial<Record<string, HostMessageHandler>>;

export type HostMessageHandlerOptions = {
  applyHalSettings: (payload: Partial<HalSettingsSnapshot> | null | undefined) => void;
  applyHalVoiceConfirmDecision: (
    decision: HalDecision,
    options?: { rejectReason?: string }
  ) => void;
  events: RenderedEvent[];
  halStateRef: RefObject<HalStateSnapshot>;
  handleConversationStarted: () => void;
  handleEvent: (event: Event) => void;
  handleHalApprove: () => void;
  handleHalExit: () => void;
  handleHalReject: (reason?: string) => void;
  handleHalTeleport: () => void;
  handleHalTeleportFailed: (error: unknown, serverUrl?: string) => void;
  handleHalTeleportUnavailable: (error: unknown) => void;
  handleHalTeleportStarting: (serverUrl: string, serverLabel?: string) => void;
  handleHalTeleportCanceled: () => void;
  handleHalTeleportSuccess: (serverUrl: string, serverLabel?: string) => void;
  handleHalTtsResponse: (payload: Record<string, unknown>) => void;
  handleHalVoiceConfirmResponse: (payload: Record<string, unknown>) => void;
  maybeUpdateHalFlow: () => void;
  pendingLlmProfilesRequestsRef: RefObject<Map<string, PendingLlmProfilesRequest>>;
  postMessage: (msg: WebviewToHostMessage) => void;
  setAgentStatus: Dispatch<SetStateAction<string | undefined>>;
  setAttachments: Dispatch<SetStateAction<Array<{ uri: string; label: string; sizeBytes?: number }>>>;
  setContextQuery: Dispatch<SetStateAction<string>>;
  setConversationId: Dispatch<SetStateAction<string | undefined>>;
  setConversationTotals: Dispatch<SetStateAction<ConversationTotals>>;
  setCurrentServerUrl: Dispatch<SetStateAction<string | undefined>>;
  setEnabledToolIds: Dispatch<SetStateAction<string[]>>;
  setEvents: Dispatch<SetStateAction<RenderedEvent[]>>;
  setHistory: Dispatch<SetStateAction<ConversationsList>>;
  setIsMentionActive: Dispatch<SetStateAction<boolean>>;
  setLlmProfileId: Dispatch<SetStateAction<string | null>>;
  setLlmProfiles: Dispatch<SetStateAction<string[]>>;
  setMode: Dispatch<SetStateAction<'local' | 'remote'>>;
  setPendingActions: Dispatch<SetStateAction<ActionEvent[]>>;
  setQueuedMessagesCount: Dispatch<SetStateAction<number>>;
  setSelectedContextFiles: Dispatch<SetStateAction<string[]>>;
  setServers: Dispatch<SetStateAction<{ url: string; label?: string }[]>>;
  setShowContextPicker: Dispatch<SetStateAction<boolean>>;
  setShowLlmProfiles: Dispatch<SetStateAction<boolean>>;
  setLlmProfilesOpenRequest: Dispatch<SetStateAction<{ mode: 'create' } | { mode: 'edit'; profileId: string } | null>>;
  setShowSkillsPopover: Dispatch<SetStateAction<boolean>>;
  setShowToolsPopover: Dispatch<SetStateAction<boolean>>;
  setSkills: Dispatch<SetStateAction<{ label: string; path: string }[]>>;
  setStatus: Dispatch<SetStateAction<'online' | 'offline' | 'connecting'>>;
  setStatusBanner: Dispatch<SetStateAction<StatusBannerState | null>>;
  setStreamingContent: Dispatch<SetStateAction<string | null>>;
  setTools: Dispatch<SetStateAction<{ id: string; label: string; description?: string; isDefault?: boolean }[]>>;
  setWorkspaceFiles: Dispatch<SetStateAction<string[]>>;
  setWelcomeSecretStatus: Dispatch<SetStateAction<WelcomeSecretStatus>>;
  showStatusMessage: ShowStatusMessage;
  currentServerUrlRef: RefObject<string | undefined>;
  conversationIdRef: RefObject<string | undefined>;
  pendingActionsRef: RefObject<ActionEvent[]>;
  pendingActionsBatchIdRef: RefObject<string | null>;
  agentStatusRef: RefObject<string | undefined>;
  mentionStartRef: RefObject<number | null>;
  hasLlmUsageRef: RefObject<boolean>;
  eventId: RefObject<number>;
  uiStateRef: RefObject<UiStateSnapshot>;
};
