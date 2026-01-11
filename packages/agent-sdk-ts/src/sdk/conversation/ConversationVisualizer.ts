import type {
  ActionEvent,
  AgentErrorEvent,
  Condensation,
  ConversationErrorEvent,
  Event,
  MessageEvent,
  ObservationEvent,
  SystemPromptEvent,
} from '../types';
import {
  isActionEvent,
  isAgentErrorEvent,
  isCondensation,
  isConversationErrorEvent,
  isConversationStateUpdateEvent,
  isMessageEvent,
  isObservationEvent,
  isPauseEvent,
  isSystemPromptEvent,
} from '../types';

export interface ConversationVisualizerOptions {
  includeTimestamps?: boolean;
  skipUserMessages?: boolean;
  skipStateUpdates?: boolean;
}

const toText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') return '<function>';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value) ?? '';
    } catch {
      return '<unserializable>';
    }
  }
  return '<unknown>';
};

const formatJson = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return '<unserializable>';
  }
};

const codeBlock = (lang: string, content: string): string => {
  const safe = content.trimEnd();
  return `\n\n\`\`\`${lang}\n${safe}\n\`\`\`\n`;
};

const formatTimestamp = (event: Event): string =>
  event.timestamp ? ` (${event.timestamp})` : '';

export class ConversationVisualizer {
  constructor(private readonly options: ConversationVisualizerOptions = {}) {}

  render(events: Event[]): string {
    const parts: string[] = [];

    for (const event of events) {
      if (this.options.skipStateUpdates && isConversationStateUpdateEvent(event)) continue;
      if (this.options.skipUserMessages && isMessageEvent(event) && event.source === 'user') continue;
      parts.push(this.renderEvent(event));
    }

    return parts.filter(Boolean).join('\n\n---\n\n');
  }

  renderEvent(event: Event): string {
    const ts = this.options.includeTimestamps ? formatTimestamp(event) : '';

    if (isSystemPromptEvent(event)) return this.renderSystemPrompt(event, ts);
    if (isMessageEvent(event)) return this.renderMessage(event, ts);
    if (isActionEvent(event)) return this.renderAction(event, ts);
    if (isObservationEvent(event)) return this.renderObservation(event, ts);
    if (isAgentErrorEvent(event)) return this.renderAgentError(event, ts);
    if (isConversationErrorEvent(event)) return this.renderConversationError(event, ts);
    if (isPauseEvent(event)) return `### Pause${ts}\n\nSource: ${event.source}`;
    if (isCondensation(event)) return this.renderCondensation(event, ts);

    return `### ${event.kind}${ts}`;
  }

  private renderSystemPrompt(event: SystemPromptEvent, ts: string): string {
    return `### System prompt${ts}${codeBlock('text', toText(event.system_prompt?.text))}`;
  }

  private renderMessage(event: MessageEvent, ts: string): string {
    const role = event.llm_message?.role;
    const header = `### Message (${role ?? 'unknown'})${ts}`;
    const content = (event.llm_message?.content ?? []).map((c) => ('text' in c ? c.text : '[image]')).join('\n');
    return `${header}${codeBlock('text', content)}`;
  }

  private renderAction(event: ActionEvent, ts: string): string {
    const header = `### Action (${event.tool_name})${ts}`;
    const thought = event.thought?.map((t) => t.text).join('\n') ?? '';
    const action = formatJson(event.action);
    return `${header}${codeBlock('text', thought)}${codeBlock('json', action)}`;
  }

  private renderObservation(event: ObservationEvent, ts: string): string {
    const header = `### Observation (${event.tool_name})${ts}`;
    return `${header}${codeBlock('json', formatJson(event.observation))}`;
  }

  private renderAgentError(event: AgentErrorEvent, ts: string): string {
    const header = `### Agent error (${event.tool_name})${ts}`;
    return `${header}${codeBlock('text', event.error)}`;
  }

  private renderConversationError(event: ConversationErrorEvent, ts: string): string {
    const header = `### Conversation error${ts}`;
    const details = [`code: ${event.code ?? 'unknown'}`, `detail: ${event.detail ?? ''}`].join('\n');
    return `${header}${codeBlock('text', details)}`;
  }

  private renderCondensation(event: Condensation, ts: string): string {
    const header = `### Condensation${ts}`;
    const details = {
      forgotten_event_ids: event.forgotten_event_ids,
      summary: event.summary,
      summary_offset: event.summary_offset,
    };
    return `${header}${codeBlock('json', formatJson(details))}`;
  }
}

export default ConversationVisualizer;
