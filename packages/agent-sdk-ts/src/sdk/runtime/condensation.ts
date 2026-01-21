import type { LLMClient, LLMToolDefinition } from '../llm';
import type { Content, Event, Message } from '../types';
import { isCondensation, isMessageEvent } from '../types';
import { LLMSummarizingCondenser } from '../context';
import { sanitizeChatMessages } from './sanitizeChatMessages';
import fs from 'fs';
import path from 'path';

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
  pastedImagesBaseDir?: string;
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

  const isEnvironmentInfoBlock = (text: string): boolean =>
    text.trimStart().toLowerCase().startsWith('<environment information>');

  const OPENHANDS_IMAGE_URL_PREFIX = 'openhands-image://';
  const IMAGE_ID_REGEX = /^[a-f0-9]{16}\.[a-z0-9]+$/;

  const EXT_TO_MIME: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };

  const toDataUrlFromOpenHandsImageId = (imageId: string): string | undefined => {
    const baseDir = typeof params.pastedImagesBaseDir === 'string' ? params.pastedImagesBaseDir : '';
    if (!baseDir) return undefined;
    if (!IMAGE_ID_REGEX.test(imageId)) return undefined;

    const ext = path.extname(imageId).toLowerCase();
    const mime = EXT_TO_MIME[ext];
    if (!mime) return undefined;

    try {
      const filePath = path.join(baseDir, 'pasted-images', imageId);
      const bytes = fs.readFileSync(filePath);
      const base64 = bytes.toString('base64');
      return `data:${mime};base64,${base64}`;
    } catch {
      return undefined;
    }
  };

  const expandOpenHandsImagesInText = (text: string): Content[] => {
    const raw = typeof text === 'string' ? text : '';
    if (!raw.includes(OPENHANDS_IMAGE_URL_PREFIX)) return [{ type: 'text', text: raw }];

    const imageRegex = /!\[([^\]]*)\]\(openhands-image:\/\/([a-f0-9]{16}\.[a-z0-9]+)\)/gi;
    const out: Content[] = [];
    let last = 0;

    let match: RegExpExecArray | null;
    while ((match = imageRegex.exec(raw)) !== null) {
      const start = match.index;
      const full = match[0] ?? '';
      const alt = (match[1] ?? '').trim();
      const imageId = (match[2] ?? '').toLowerCase();
      const dataUrl = toDataUrlFromOpenHandsImageId(imageId);

      if (start > last) {
        out.push({ type: 'text', text: raw.slice(last, start) });
      }

      if (dataUrl) {
        const label = alt || imageId;
        out.push({ type: 'text', text: `\n\n[Image: ${label}]\n\n` });
        out.push({ type: 'image', image_urls: [dataUrl], detail: 'auto' });
      } else {
        out.push({ type: 'text', text: full });
      }

      last = start + full.length;
    }

    if (last < raw.length) {
      out.push({ type: 'text', text: raw.slice(last) });
    }

    if (out.length === 0) return [{ type: 'text', text: raw }];
    return out;
  };

  const maybeExpandOpenHandsImages = (message: Message): Message => {
    const baseDir = typeof params.pastedImagesBaseDir === 'string' ? params.pastedImagesBaseDir : '';
    if (!baseDir) return message;
    if (message.role !== 'user') return message;

    const nextContent: Content[] = [];
    for (const part of message.content) {
      if (part.type !== 'text') {
        nextContent.push(part);
        continue;
      }
      nextContent.push(...expandOpenHandsImagesInText(part.text));
    }

    // Avoid churn if no image expansion occurred.
    const changed = nextContent.some((p) => p.type === 'image') || nextContent.length !== message.content.length;
    if (!changed) return message;
    return { ...message, content: nextContent };
  };

  const rawMessages = messageEvents.map((event, idx) => {
    if (event.source === 'user' && event.extended_content?.length) {
      // Environment info is ephemeral and should reflect the latest editor state only.
      // Keep other extended content (e.g. watched-file notes, skill suffixes) attached to its
      // original message so it remains in conversation history.
      const extendedContent =
        idx === lastUserMessageIndex
          ? event.extended_content
          : event.extended_content.filter((c) => !(c.type === 'text' && isEnvironmentInfoBlock(c.text)));

      if (extendedContent.length > 0) {
        return { ...event.llm_message, content: [...event.llm_message.content, ...extendedContent] };
      }
    }
    return event.llm_message;
  }).map(maybeExpandOpenHandsImages);
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
