import type { RefObject } from 'react';
import type { LLMConfiguration } from '@openhands/agent-sdk-ts';
import { isEvent } from '@openhands/agent-sdk-ts';
import { getVscodeApi } from '../../../shared/vscodeApi';
import type { HalSettingsSnapshot } from '../useHalFlow';
import { isHalDecision } from '../../../../shared/halTypes';
import type { ConversationsList, HostMessageHandlerOptions, WebviewPersistedState } from './types';
import type { StatusBannerState } from '../useStatusMessages';

export function createHostMessageHandler(args: {
  options: HostMessageHandlerOptions;
  lastModeRef: RefObject<'local' | 'remote' | null>;
}): (event: MessageEvent) => void {
  const { lastModeRef } = args;
  const {
    applyHalSettings,
    applyHalVoiceConfirmDecision,
    events,
    halStateRef,
    handleConversationStarted,
    handleEvent,
    handleHalApprove,
    handleHalExit,
    handleHalReject,
    handleHalTeleport,
    handleHalTeleportFailed,
    handleHalTeleportUnavailable,
    handleHalTeleportStarting,
    handleHalTeleportCanceled,
    handleHalTeleportSuccess,
    handleHalTtsResponse,
    handleHalVoiceConfirmResponse,
    maybeUpdateHalFlow,
    pendingLlmProfilesRequestsRef,
    postMessage,
    setAgentStatus,
    setAttachments,
    setContextQuery,
    setConversationId,
    setCurrentServerUrl,
    setEnabledToolIds,
    setEvents,
    setHistory,
    setIsMentionActive,
    setLlmProfileId,
    setLlmProfiles,
    setMode,
    setPendingActions,
    setQueuedMessagesCount,
    setSelectedContextFiles,
    setServers,
    setShowContextPicker,
    setShowLlmProfiles,
    setLlmProfilesOpenRequest,
    setShowSkillsPopover,
    setShowToolsPopover,
    setSkills,
    setStatus,
    setStatusBanner,
    setStreamingContent,
    setTools,
    setWorkspaceFiles,
    setWelcomeSecretStatus,
    showStatusMessage,
    currentServerUrlRef,
    conversationIdRef,
    pendingActionsRef,
    pendingActionsBatchIdRef,
    agentStatusRef,
    mentionStartRef,
    eventId,
    uiStateRef,
  } = args.options;

  return (event: MessageEvent) => {
    const payload = event.data as {
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
    };

    switch (payload?.type) {
      case 'status':
        if (payload.status) {
          setStatus(payload.status);
          if (payload.mode === 'local' || payload.mode === 'remote') {
            setMode(payload.mode);
            if (payload.mode === 'local' && lastModeRef.current !== 'local') {
              lastModeRef.current = 'local';
              postMessage({ type: 'requestTools' });
            } else if (payload.mode === 'remote' && lastModeRef.current !== 'remote') {
              lastModeRef.current = 'remote';
            }
          }
          const nextBanner: StatusBannerState | null =
            payload.mode === 'local'
              ? { message: 'Local mode: running without remote server', level: 'info', dismissible: false }
              : payload.status === 'connecting'
                ? { message: 'Connecting to server…', level: 'info' }
                : payload.status === 'online'
                  ? { message: 'Connected to server', level: 'info' }
                  : payload.status === 'offline'
                    ? { message: 'Disconnected from server', level: 'warn' }
                    : null;

          if (nextBanner) {
            setStatusBanner((prev) => {
              if (!prev) return nextBanner;
              if (
                prev.message === nextBanner.message
                && prev.level === nextBanner.level
                && prev.dismissible === nextBanner.dismissible
              ) {
                return prev;
              }
              return nextBanner;
            });
          }
        }
        break;
      case 'welcomeSecretStatus': {
        const hasProviderKey = payload.hasProviderKey === true;
        const hasGeminiKey = payload.hasGeminiKey === true;
        setWelcomeSecretStatus({ hasProviderKey, hasGeminiKey });
        break;
      }
      case 'statusMessage': {
        const level = payload.level;
        const message = payload.message;
        if ((level === 'info' || level === 'warn' || level === 'error') && typeof message === 'string' && message.trim()) {
          const autoDismiss = payload.autoDismiss === true;
          const autoDismissDelay = typeof payload.autoDismissDelay === 'number' && Number.isFinite(payload.autoDismissDelay)
            ? Math.max(0, payload.autoDismissDelay)
            : undefined;
          showStatusMessage(level, message.trim(), { autoDismiss, autoDismissDelay });
        }
        break;
      }
      case 'config': {
        const url = typeof payload.serverUrl === 'string' ? payload.serverUrl : null;
        const nextUrl = url ? url : undefined;

        if (payload.mode === 'local') {
          lastModeRef.current = 'local';
          setMode('local');
          currentServerUrlRef.current = undefined;
          setCurrentServerUrl(undefined);
          setStatusBanner({ message: 'Local mode: running without remote server', level: 'info', dismissible: false });
          postMessage({ type: 'requestTools' });
        } else if (payload.mode === 'remote') {
          lastModeRef.current = 'remote';
          setMode('remote');
          currentServerUrlRef.current = nextUrl;
          setCurrentServerUrl(nextUrl);
        } else {
          currentServerUrlRef.current = nextUrl;
          setCurrentServerUrl(nextUrl);
        }
        break;
      }
      case 'llmProfilesUpdated': {
        if (Array.isArray(payload.profiles)) {
          setLlmProfiles(payload.profiles.filter((id): id is string => typeof id === 'string'));
        }
        if (typeof payload.activeProfileId === 'string' || payload.activeProfileId === null) {
          setLlmProfileId(payload.activeProfileId);
        }
        break;
      }
      case 'llmProfilesListResponse': {
        const requestId = payload.requestId;
        if (typeof requestId !== 'string') break;
        const pending = pendingLlmProfilesRequestsRef.current.get(requestId);
        if (!pending || pending.kind !== 'list') break;
        pendingLlmProfilesRequestsRef.current.delete(requestId);
        clearTimeout(pending.timeout);
        if (payload.ok === true && Array.isArray(payload.profiles)) {
          pending.resolve(payload.profiles.filter((id): id is string => typeof id === 'string' && id.trim().length > 0));
          break;
        }
        const reason = typeof payload.error === 'string' ? payload.error : 'Failed to list LLM profiles';
        pending.reject(new Error(reason));
        break;
      }
      case 'llmProfileLoadResponse': {
        const requestId = payload.requestId;
        if (typeof requestId !== 'string') break;
        const pending = pendingLlmProfilesRequestsRef.current.get(requestId);
        if (!pending || pending.kind !== 'load') break;
        pendingLlmProfilesRequestsRef.current.delete(requestId);
        clearTimeout(pending.timeout);
        if (payload.ok === true && payload.profile && typeof payload.profile === 'object') {
          pending.resolve(payload.profile as LLMConfiguration);
          break;
        }
        const reason = typeof payload.error === 'string' ? payload.error : 'Failed to load LLM profile';
        pending.reject(new Error(reason));
        break;
      }
      case 'llmProfileSaveResponse': {
        const requestId = payload.requestId;
        if (typeof requestId !== 'string') break;
        const pending = pendingLlmProfilesRequestsRef.current.get(requestId);
        if (!pending || pending.kind !== 'save') break;
        pendingLlmProfilesRequestsRef.current.delete(requestId);
        clearTimeout(pending.timeout);
        if (payload.ok === true) {
          pending.resolve();
          break;
        }
        const reason = typeof payload.error === 'string' ? payload.error : 'Failed to save LLM profile';
        pending.reject(new Error(reason));
        break;
      }
      case 'llmProfileDeleteResponse': {
        const requestId = payload.requestId;
        if (typeof requestId !== 'string') break;
        const pending = pendingLlmProfilesRequestsRef.current.get(requestId);
        if (!pending || pending.kind !== 'delete') break;
        pendingLlmProfilesRequestsRef.current.delete(requestId);
        clearTimeout(pending.timeout);
        if (payload.ok === true) {
          pending.resolve();
          break;
        }
        const reason = typeof payload.error === 'string' ? payload.error : 'Failed to delete LLM profile';
        pending.reject(new Error(reason));
        break;
      }
      case 'llmProfileApiKeyStatusResponse': {
        const requestId = payload.requestId;
        if (typeof requestId !== 'string') break;
        const pending = pendingLlmProfilesRequestsRef.current.get(requestId);
        if (!pending || pending.kind !== 'apiKeyStatus') break;
        pendingLlmProfilesRequestsRef.current.delete(requestId);
        clearTimeout(pending.timeout);
        const providerKeyName = typeof payload.providerKeyName === 'string' ? payload.providerKeyName : undefined;
        if (
          payload.ok === true &&
          typeof payload.hasKey === 'boolean' &&
          typeof payload.hasProfileKey === 'boolean' &&
          typeof payload.hasProviderKey === 'boolean'
        ) {
          pending.resolve({
            hasKey: payload.hasKey,
            hasProfileKey: payload.hasProfileKey,
            hasProviderKey: payload.hasProviderKey,
            providerKeyName,
          });
          break;
        }
        if (payload.ok === true && typeof payload.hasKey === 'boolean') {
          pending.resolve({
            hasKey: payload.hasKey,
            hasProfileKey: payload.hasKey,
            hasProviderKey: false,
            providerKeyName,
          });
          break;
        }
        const reason = typeof payload.error === 'string' ? payload.error : 'Failed to fetch LLM profile API key status';
        pending.reject(new Error(reason));
        break;
      }
      case 'llmProfileApiKeySetResponse': {
        const requestId = payload.requestId;
        if (typeof requestId !== 'string') break;
        const pending = pendingLlmProfilesRequestsRef.current.get(requestId);
        if (!pending || pending.kind !== 'apiKeySet') break;
        pendingLlmProfilesRequestsRef.current.delete(requestId);
        clearTimeout(pending.timeout);
        if (payload.ok === true) {
          pending.resolve();
          break;
        }
        const reason = typeof payload.error === 'string' ? payload.error : 'Failed to set LLM profile API key';
        pending.reject(new Error(reason));
        break;
      }
      case 'configUpdated':
        if (typeof payload.serverUrl === 'string' || payload.serverUrl === null) {
          const url = payload.serverUrl || undefined;
          setCurrentServerUrl(url);
          const label = url || 'local mode';
          showStatusMessage('info', `Config updated: ${label}`);
        }
        if (payload.mode === 'local') {
          setMode('local');
          setCurrentServerUrl(undefined);
          setStatusBanner({ message: 'Local mode: running without remote server', level: 'info', dismissible: false });
        } else if (payload.mode === 'remote') {
          setMode('remote');
        }
        break;
      case 'serverListUpdated': {
        if (Array.isArray(payload.servers)) {
          setServers(payload.servers);
        }
        if (typeof payload.serverUrl === 'string') {
          const nextUrl = payload.serverUrl || undefined;
          currentServerUrlRef.current = nextUrl;
          setCurrentServerUrl(nextUrl);
        }
        break;
      }
      case 'halSettings':
        applyHalSettings(payload.hal);
        break;
      case 'halTtsResponse': {
        handleHalTtsResponse(payload as Record<string, unknown>);
        break;
      }
      case 'halVoiceConfirmResponse': {
        handleHalVoiceConfirmResponse(payload as Record<string, unknown>);
        break;
      }
      case 'attachmentsSelected':
        if (Array.isArray(payload.attachments)) {
          setAttachments((prev) => {
            const existing = new Set(prev.map((a) => a.uri));
            const next = [...prev];
            for (const a of payload.attachments ?? []) {
              if (!a || typeof a.uri !== 'string' || typeof a.label !== 'string') continue;
              if (existing.has(a.uri)) continue;
              next.push(a);
              existing.add(a.uri);
            }
            return next;
          });
        }
        break;
      case 'event':
        if (isEvent(payload.event)) {
          handleEvent(payload.event);
          if (typeof payload.seq === 'number') {
            const api = getVscodeApi();
            const prev = api.getState?.<WebviewPersistedState>() ?? {};
            api.setState?.({ ...prev, lastSeenSeq: payload.seq });
          }
        }
        break;
      case 'error':
        if (typeof payload.error === 'string') {
          setStatusBanner({ message: payload.error, level: 'error' });
        } else {
          setStatusBanner({ message: 'An unknown error occurred', level: 'error' });
        }
        break;
      case 'halTeleportUnavailable': {
        handleHalTeleportUnavailable(payload.error);
        break;
      }
      case 'halTeleportFailed': {
        const serverUrl = typeof payload.serverUrl === 'string' ? payload.serverUrl : undefined;
        handleHalTeleportFailed(payload.error, serverUrl);
        break;
      }
      case 'halTeleportStarting': {
        if (typeof payload.serverUrl === 'string') {
          handleHalTeleportStarting(payload.serverUrl, payload.serverLabel);
        }
        break;
      }
      case 'halTeleportCanceled': {
        handleHalTeleportCanceled();
        break;
      }
      case 'halTeleportSuccess': {
        if (typeof payload.serverUrl === 'string') {
          currentServerUrlRef.current = payload.serverUrl;
          setCurrentServerUrl(payload.serverUrl);
          handleHalTeleportSuccess(payload.serverUrl, payload.serverLabel);
        }
        break;
      }
      case 'conversationStarted':
        if (typeof payload.conversationId === 'string') {
          handleConversationStarted();
          conversationIdRef.current = payload.conversationId;
          setConversationId(payload.conversationId);
          setEvents([]);
          pendingActionsRef.current = [];
          pendingActionsBatchIdRef.current = null;
          setPendingActions([]);
          agentStatusRef.current = undefined;
          setAgentStatus(undefined);
          setQueuedMessagesCount(0);
          setStreamingContent(null);
          eventId.current = 1;
          setShowToolsPopover(false);
          postMessage({ type: 'requestTools' });
          // No toast: UI clears and restored/started messages will render naturally
          const api = getVscodeApi();
          api.setState?.({ conversationId: payload.conversationId, lastSeenSeq: 0 });
          maybeUpdateHalFlow();
        }
        break;
      case 'workspaceFiles':
        if (Array.isArray(payload.files)) {
          setWorkspaceFiles(payload.files.filter((f): f is string => typeof f === 'string'));
        }
        break;
      case 'skillsList':
        if (Array.isArray(payload.skills)) {
          setSkills(
            payload.skills.filter((skill): skill is { label: string; path: string } => (
              typeof skill === 'object'
              && skill !== null
              && typeof (skill as { label?: unknown }).label === 'string'
              && typeof (skill as { path?: unknown }).path === 'string'
            ))
          );
        }
        break;
      case 'toolsList': {
        if (!Array.isArray(payload.tools) || !Array.isArray(payload.enabledToolIds)) break;
        setTools(
          payload.tools
            .filter((tool): tool is { id: string; label: string; description?: string; isDefault?: boolean } => (
              typeof tool === 'object'
              && tool !== null
              && typeof (tool as { id?: unknown }).id === 'string'
              && typeof (tool as { label?: unknown }).label === 'string'
            ))
            .map((tool) => ({
              id: tool.id,
              label: tool.label,
              description: typeof (tool as { description?: unknown }).description === 'string'
                ? (tool as { description: string }).description
                : undefined,
              isDefault: typeof (tool as { isDefault?: unknown }).isDefault === 'boolean'
                ? (tool as { isDefault: boolean }).isDefault
                : undefined,
            }))
        );
        setEnabledToolIds(payload.enabledToolIds.filter((id): id is string => typeof id === 'string'));
        break;
      }
      case 'queryUiState': {
        if (typeof payload.requestId === 'string') {
          postMessage({ type: 'uiStateResponse', requestId: payload.requestId, ...uiStateRef.current });
        }
        break;
      }
      case 'queryHalState': {
        if (typeof payload.requestId === 'string') {
          postMessage({ type: 'halStateResponse', requestId: payload.requestId, ...halStateRef.current });
        }
        break;
      }
      case 'e2eAction': {
        if (typeof (payload as { action?: unknown }).action !== 'string') break;
        const action = (payload as { action: string }).action;
        const rawPayload = (payload as { payload?: unknown }).payload;

        switch (action) {
          case 'openContext':
            setShowSkillsPopover(false);
            setShowToolsPopover(false);
            setShowContextPicker(true);
            postMessage({ type: 'requestWorkspaceFiles' });
            break;
          case 'closeContext':
            setShowContextPicker(false);
            setIsMentionActive(false);
            setContextQuery('');
            mentionStartRef.current = null;
            break;
          case 'toggleContextFile': {
            const file = (rawPayload as { file?: unknown } | undefined)?.file;
            if (typeof file !== 'string' || file.length === 0) break;
            setSelectedContextFiles((prev) => (prev.includes(file) ? prev.filter((f) => f !== file) : [...prev, file]));
            break;
          }
          case 'openSkills':
            setShowContextPicker(false);
            setShowToolsPopover(false);
            setShowSkillsPopover(true);
            postMessage({ type: 'requestSkills' });
            break;
          case 'closeSkills':
            setShowSkillsPopover(false);
            break;
          case 'openAttachments':
            postMessage({ type: 'selectAttachments' });
            break;
          case 'sendMessage': {
            const text = (rawPayload as { text?: unknown } | undefined)?.text;
            if (typeof text !== 'string') break;
            const normalized = text.trim();
            if (!normalized) break;
            postMessage({ type: 'send', text: normalized, contextFiles: [], attachments: [] });
            break;
          }
          case 'selectServer': {
            const url = (rawPayload as { url?: unknown } | undefined)?.url;
            if (typeof url !== 'string') break;
            const normalized = url.trim();
            if (!normalized) break;
            postMessage({ type: 'selectServer', url: normalized });
            break;
          }
          case 'setLlmProfileId': {
            const profileIdRaw = (rawPayload as { profileId?: unknown } | undefined)?.profileId;
            if (profileIdRaw === undefined) break;
            if (profileIdRaw !== null && typeof profileIdRaw !== 'string') break;
            const profileId = profileIdRaw;
            setLlmProfileId(profileId);
            postMessage({ type: 'setLlmProfileId', profileId });
            break;
          }
          case 'setEnabledTools': {
            const toolIdsRaw = (rawPayload as { toolIds?: unknown } | undefined)?.toolIds;
            if (!Array.isArray(toolIdsRaw)) break;
            const toolIds = toolIdsRaw.filter((id): id is string => typeof id === 'string');
            postMessage({ type: 'setEnabledTools', toolIds });
            break;
          }
          case 'openLlmProfilesView': {
            const mode = (rawPayload as { mode?: unknown } | undefined)?.mode;
            const profileIdRaw = (rawPayload as { profileId?: unknown } | undefined)?.profileId;
            setShowLlmProfiles(true);
            if (mode === 'create') {
              setLlmProfilesOpenRequest({ mode: 'create' });
              break;
            }
            if (mode === 'edit' && typeof profileIdRaw === 'string' && profileIdRaw.trim()) {
              setLlmProfilesOpenRequest({ mode: 'edit', profileId: profileIdRaw.trim() });
              break;
            }
            setLlmProfilesOpenRequest(null);
            break;
          }
          case 'closeLlmProfilesView':
            setShowLlmProfiles(false);
            setLlmProfilesOpenRequest(null);
            break;
          case 'halApprove':
            handleHalApprove();
            break;
          case 'halReject':
            handleHalReject('E2E reject');
            break;
          case 'halTeleport':
            handleHalTeleport();
            break;
          case 'halVoiceConfirmDecision': {
            const decisionRaw = (rawPayload as { decision?: unknown } | undefined)?.decision;
            if (!isHalDecision(decisionRaw)) break;
            applyHalVoiceConfirmDecision(decisionRaw, { rejectReason: 'E2E reject' });
            break;
          }
          case 'halExit':
            handleHalExit();
            break;
        }
        break;
      }
      case 'queryRenderedEvents': {
        const eventSnapshots = events.map(({ event }) => {
          if ('kind' in event && typeof event.kind === 'string') return event.kind;
          if ('type' in event && typeof (event as { type?: unknown }).type === 'string') {
            return (event as { type: string }).type;
          }
          return 'unknown';
        });
        const eventTypes = eventSnapshots;
        const rendered = events.map(({ event }, index) => {
          const type = eventSnapshots[index] ?? 'unknown';
          const marker = (event as { e2e_marker?: unknown }).e2e_marker;
          const toolCallId = (event as { tool_call_id?: unknown }).tool_call_id;
          const role = type === 'MessageEvent'
            ? (event as { llm_message?: { role?: unknown } }).llm_message?.role
            : undefined;
          return {
            type,
            marker: typeof marker === 'string' ? marker : undefined,
            toolCallId: typeof toolCallId === 'string' ? toolCallId : undefined,
            role: typeof role === 'string' ? role : undefined,
          };
        });
        if (typeof payload.requestId === 'string') {
          postMessage({
            type: 'renderedEventsResponse',
            requestId: payload.requestId,
            count: events.length,
            eventTypes,
            events: rendered
          });
        }
        break;
      }
      case 'historyList': {
        const list = Array.isArray(payload.conversations) ? payload.conversations : [];
        setHistory(list);
        break;
      }
    }
  };
}
