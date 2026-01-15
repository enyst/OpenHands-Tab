import { useEffect, useRef } from 'react';
import type { HostMessageHandlerOptions } from './hostMessages/types';
import { createHostMessageHandler } from './hostMessages/createHostMessageHandler';

export type { HostMessageHandlerOptions } from './hostMessages/types';

export function useHostMessages(options: HostMessageHandlerOptions): void {
  const lastModeRef = useRef<'local' | 'remote' | null>(null);

  useEffect(() => {
    const handler = createHostMessageHandler({ options, lastModeRef });

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [
    options.applyHalSettings,
    options.applyHalVoiceConfirmDecision,
    options.agentStatusRef,
    options.events,
    options.eventId,
    options.hasLlmUsageRef,
    options.halStateRef,
    options.handleConversationStarted,
    options.handleEvent,
    options.handleHalApprove,
    options.handleHalExit,
    options.handleHalReject,
    options.handleHalTeleport,
    options.handleHalTeleportFailed,
    options.handleHalTeleportUnavailable,
    options.handleHalTeleportStarting,
    options.handleHalTeleportCanceled,
    options.handleHalTeleportSuccess,
    options.handleHalTtsResponse,
    options.handleHalVoiceConfirmResponse,
    options.mentionStartRef,
    options.maybeUpdateHalFlow,
    options.pendingActionsBatchIdRef,
    options.pendingActionsRef,
    options.postMessage,
    options.pendingLlmProfilesRequestsRef,
    options.setAgentStatus,
    options.setAttachments,
    options.setContextQuery,
    options.setConversationId,
    options.setConversationTotals,
    options.setCurrentServerUrl,
    options.setEnabledToolIds,
    options.setEvents,
    options.setHistory,
    options.setIsMentionActive,
    options.setLlmProfileId,
    options.setLlmProfiles,
    options.setMode,
    options.setPendingActions,
    options.setSelectedContextFiles,
    options.setServers,
    options.setShowContextPicker,
    options.setShowLlmProfiles,
    options.setLlmProfilesOpenRequest,
    options.setShowSkillsPopover,
    options.setShowToolsPopover,
    options.setSkills,
    options.setStatus,
    options.setStatusBanner,
    options.setStreamingContent,
    options.setTools,
    options.setWorkspaceFiles,
    options.showStatusMessage,
    options.conversationIdRef,
    options.currentServerUrlRef,
    options.uiStateRef,
  ]);
}
