import type { WebviewToHostMessage } from '../../../shared/webviewMessages';
import type { CreateWebviewMessageHandlerDeps } from '../createWebviewMessageHandler';

export function handleRenderedEventsResponse(args: {
  deps: CreateWebviewMessageHandlerDeps;
  message: Extract<WebviewToHostMessage, { type: 'renderedEventsResponse' }>;
}): void {
  args.deps.onRenderedEventsResponse(args.message.requestId, {
    count: args.message.count,
    eventTypes: args.message.eventTypes,
    events: args.message.events,
  });
}

export function handleUiStateResponse(args: {
  deps: CreateWebviewMessageHandlerDeps;
  message: Extract<WebviewToHostMessage, { type: 'uiStateResponse' }>;
}): void {
  args.deps.onUiStateResponse(args.message.requestId, {
    input: args.message.input,
    showContextPicker: args.message.showContextPicker,
    showSkillsPopover: args.message.showSkillsPopover,
    showHistory: args.message.showHistory,
    workspaceFilesCount: args.message.workspaceFilesCount,
    selectedContextFiles: args.message.selectedContextFiles,
    skillsCount: args.message.skillsCount,
    attachmentsCount: args.message.attachmentsCount,
    hasWelcomeProviderKey: args.message.hasWelcomeProviderKey,
    hasWelcomeGeminiKey: args.message.hasWelcomeGeminiKey,
    showWelcomeProviderKeyMessage: args.message.showWelcomeProviderKeyMessage,
    showWelcomeGeminiKeyMessage: args.message.showWelcomeGeminiKeyMessage,
  });
}

export function handleHalStateResponse(args: {
  deps: CreateWebviewMessageHandlerDeps;
  message: Extract<WebviewToHostMessage, { type: 'halStateResponse' }>;
}): void {
  args.deps.onHalStateResponse(args.message.requestId, {
    enabled: args.message.enabled,
    mode: args.message.mode,
    phase: args.message.phase,
    eye: args.message.eye,
    stepIndex: args.message.stepIndex,
    decision: args.message.decision,
    lastError: args.message.lastError,
  });
}

