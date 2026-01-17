import type { LLMClient, LLMToolDefinition } from '../llm';
import type { Event, Message } from '../types';
import { isCondensation, isMessageEvent } from '../types';
import { LLMSummarizingCondenser } from '../context';
import { sanitizeChatMessages } from './sanitizeChatMessages';

export type CondensationState = {
  summary: string | null;
  forgottenEventIds: Set<string>;
  summaryOffset: number | null;
};

export const getCondensationState = (events: Event[]): CondensationState => {
  const forgottenEventIds = new Set<string>();
  let summary: string | null = null;
  let summaryOffset: number | null = null;

  for (const event of events) {
    if (!isCondensation(event)) continue;
    for (const id of event.forgotten_event_ids ?? []) {
      if (typeof id === 'string' && id.trim()) forgottenEventIds.add(id);
    }
    if (typeof event.summary === 'string' && event.summary.trim()) {
      summary = event.summary.trim();
      const rawOffset = event.summary_offset;
      summaryOffset = typeof rawOffset === 'number' && Number.isFinite(rawOffset) ? Math.max(0, Math.trunc(rawOffset)) : null;
    }
  }

  return { summary, forgottenEventIds, summaryOffset };
};

export const buildChatRequestWithCondensation = (params: {
  events: Event[];
  systemPrompt: string;
  tools: LLMToolDefinition[];
}): { systemPrompt: string; messages: Message[]; tools: LLMToolDefinition[] } => {
  const condensationState = getCondensationState(params.events);

  let systemPrompt = params.systemPrompt;
  if (condensationState.summary) {
    systemPrompt += `\n\n<CONVERSATION SUMMARY>\n${condensationState.summary}\n</CONVERSATION SUMMARY>`;
  }

  const messageEvents = params.events
    .filter(isMessageEvent)
    .filter((event) => !condensationState.forgottenEventIds.has(event.id ?? ''));

  const lastUserMessageIndex = (() => {
    for (let i = messageEvents.length - 1; i >= 0; i -= 1) {
      if (messageEvents[i]?.source === 'user') return i;
    }
    return -1;
  })();

  const rawMessages = messageEvents.map((event, idx) => {
    // Only attach extended_content to the most recent user message so stale environment info
    // from earlier turns doesn't pollute the request context.
    if (idx === lastUserMessageIndex && event.source === 'user' && event.extended_content?.length) {
      return { ...event.llm_message, content: [...event.llm_message.content, ...event.extended_content] };
    }
    return event.llm_message;
  });
  const messages = sanitizeChatMessages(rawMessages);

  return { systemPrompt, messages, tools: params.tools };
};

export type CondensationResult = {
  summary: string | null;
  forgottenEventIds: string[];
  summaryOffset: number | null;
};

export type CondensationDeps = {
  maxInputTokens: number;
  listEvents: () => Event[];
  pushEvent: (event: Event) => Promise<unknown>;
  /**
   * Optional override used by unit tests. When provided, `getPrimaryLlmClient` is not called.
   */
  condense?: (params: { events: Event[]; previousSummary: string; maxInputTokens: number }) => Promise<CondensationResult | undefined>;
  getPrimaryLlmClient?: () => Promise<LLMClient>;
};

export const tryCondenseConversation = async (deps: CondensationDeps): Promise<boolean> => {
  const maxInputTokens = Math.max(0, Math.trunc(deps.maxInputTokens));
  if (maxInputTokens <= 0) return false;

  const events = deps.listEvents();
  const condensationState = getCondensationState(events);
  const condensableEvents = events
    .filter(isMessageEvent)
    .filter((event) => !condensationState.forgottenEventIds.has(event.id ?? ''));
  const previousSummary = condensationState.summary ?? '';

  let result: CondensationResult | undefined;
  if (deps.condense) {
    result = await deps.condense({ events: condensableEvents, previousSummary, maxInputTokens });
  } else {
    if (!deps.getPrimaryLlmClient) return false;
    let llm: LLMClient;
    try {
      llm = await deps.getPrimaryLlmClient();
    } catch {
      return false;
    }

    const condenser = new LLMSummarizingCondenser(llm, { maxInputTokens });
    try {
      const condensed = await condenser.condense({ events: condensableEvents, previousSummary });
      if (!condensed) return false;
      result = {
        summary: condensed.summary ?? null,
        forgottenEventIds: condensed.forgottenEventIds,
        summaryOffset: condensed.summaryOffset ?? null,
      };
    } catch {
      return false;
    }
  }

  if (!result?.summary) return false;
  if (!result.forgottenEventIds.length) return false;

  const condensationEvent: Extract<Event, { kind: 'Condensation' }> = {
    kind: 'Condensation',
    source: 'environment',
    forgotten_event_ids: result.forgottenEventIds,
    summary: result.summary,
    summary_offset: result.summaryOffset,
  };

  await deps.pushEvent(condensationEvent);

  return true;
};
