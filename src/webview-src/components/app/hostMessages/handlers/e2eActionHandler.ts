import { isHalDecision } from '../../../../../shared/halTypes';
import type { HostMessageHandler, HostMessageHandlerOptions } from '../types';

export function createE2eActionHandler(
  options: Pick<HostMessageHandlerOptions,
    | 'applyHalVoiceConfirmDecision'
    | 'handleHalApprove'
    | 'handleHalExit'
    | 'handleHalReject'
    | 'handleHalTeleport'
    | 'mentionStartRef'
    | 'postMessage'
    | 'setContextQuery'
    | 'setEnabledToolIds'
    | 'setIsMentionActive'
    | 'setLlmProfileId'
    | 'setLlmProfilesOpenRequest'
    | 'setSelectedContextFiles'
    | 'setShowContextPicker'
    | 'setShowLlmProfiles'
    | 'setShowSkillsPopover'
    | 'setShowToolsPopover'>,
): HostMessageHandler {
  const {
    applyHalVoiceConfirmDecision,
    handleHalApprove,
    handleHalExit,
    handleHalReject,
    handleHalTeleport,
    mentionStartRef,
    postMessage,
    setContextQuery,
    setIsMentionActive,
    setLlmProfileId,
    setLlmProfilesOpenRequest,
    setSelectedContextFiles,
    setShowContextPicker,
    setShowLlmProfiles,
    setShowSkillsPopover,
    setShowToolsPopover,
  } = options;

  return (payload) => {
    if (typeof payload.action !== 'string') {
      return;
    }

    const action = payload.action;
    const rawPayload = payload.payload;

    switch (action) {
      case 'openContext':
        setShowSkillsPopover(false);
        setShowToolsPopover(false);
        setShowContextPicker(true);
        postMessage({ type: 'requestWorkspaceFiles' });
        return;
      case 'closeContext':
        setShowContextPicker(false);
        setIsMentionActive(false);
        setContextQuery('');
        mentionStartRef.current = null;
        return;
      case 'toggleContextFile': {
        const file = (rawPayload as { file?: unknown } | undefined)?.file;
        if (typeof file !== 'string' || file.length === 0) {
          return;
        }
        setSelectedContextFiles((prev) => (prev.includes(file) ? prev.filter((value) => value !== file) : [...prev, file]));
        return;
      }
      case 'openSkills':
        setShowContextPicker(false);
        setShowToolsPopover(false);
        setShowSkillsPopover(true);
        postMessage({ type: 'requestSkills' });
        return;
      case 'closeSkills':
        setShowSkillsPopover(false);
        return;
      case 'openAttachments':
        postMessage({ type: 'selectAttachments' });
        return;
      case 'sendMessage': {
        const text = (rawPayload as { text?: unknown } | undefined)?.text;
        if (typeof text !== 'string') {
          return;
        }
        const normalized = text.trim();
        if (!normalized) {
          return;
        }
        postMessage({ type: 'send', text: normalized, contextFiles: [], attachments: [] });
        return;
      }
      case 'selectServer': {
        const url = (rawPayload as { url?: unknown } | undefined)?.url;
        if (typeof url !== 'string') {
          return;
        }
        const normalized = url.trim();
        if (!normalized) {
          return;
        }
        postMessage({ type: 'selectServer', url: normalized });
        return;
      }
      case 'setLlmProfileId': {
        const profileIdRaw = (rawPayload as { profileId?: unknown } | undefined)?.profileId;
        if (profileIdRaw === undefined) {
          return;
        }
        if (profileIdRaw !== null && typeof profileIdRaw !== 'string') {
          return;
        }
        setLlmProfileId(profileIdRaw);
        postMessage({ type: 'setLlmProfileId', profileId: profileIdRaw });
        return;
      }
      case 'setEnabledTools': {
        const toolIdsRaw = (rawPayload as { toolIds?: unknown } | undefined)?.toolIds;
        if (!Array.isArray(toolIdsRaw)) {
          return;
        }
        const toolIds = toolIdsRaw.filter((id): id is string => typeof id === 'string');
        postMessage({ type: 'setEnabledTools', toolIds });
        return;
      }
      case 'openLlmProfilesView': {
        const mode = (rawPayload as { mode?: unknown } | undefined)?.mode;
        const profileIdRaw = (rawPayload as { profileId?: unknown } | undefined)?.profileId;
        setShowLlmProfiles(true);
        if (mode === 'create') {
          setLlmProfilesOpenRequest({ mode: 'create' });
          return;
        }
        if (mode === 'edit' && typeof profileIdRaw === 'string' && profileIdRaw.trim()) {
          setLlmProfilesOpenRequest({ mode: 'edit', profileId: profileIdRaw.trim() });
          return;
        }
        setLlmProfilesOpenRequest(null);
        return;
      }
      case 'closeLlmProfilesView':
        setShowLlmProfiles(false);
        setLlmProfilesOpenRequest(null);
        return;
      case 'halApprove':
        handleHalApprove();
        return;
      case 'halReject':
        handleHalReject('E2E reject');
        return;
      case 'halTeleport':
        handleHalTeleport();
        return;
      case 'halVoiceConfirmDecision': {
        const decisionRaw = (rawPayload as { decision?: unknown } | undefined)?.decision;
        if (!isHalDecision(decisionRaw)) {
          return;
        }
        applyHalVoiceConfirmDecision(decisionRaw, { rejectReason: 'E2E reject' });
        return;
      }
      case 'halExit':
        handleHalExit();
        return;
      default:
        return;
    }
  };
}
