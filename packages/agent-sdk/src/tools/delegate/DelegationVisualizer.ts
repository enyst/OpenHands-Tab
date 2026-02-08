import type { ActionEvent, Event, MessageEvent, ObservationEvent, SystemPromptEvent } from '../../sdk/types';
import {
  isActionEvent,
  isMessageEvent,
  isObservationEvent,
  isSystemPromptEvent,
} from '../../sdk/types';

export interface DelegationVisualizerOptions {
  name?: string | null;
  includeTimestamps?: boolean;
  skipUserMessages?: boolean;
}

const toOptionalNonEmptyString = (value: unknown): string | undefined => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed : undefined;
};

const formatTimestamp = (event: Event): string => (event.timestamp ? ` (${event.timestamp})` : '');

export class DelegationVisualizer {
  private readonly name?: string;
  private readonly includeTimestamps: boolean;
  private readonly skipUserMessages: boolean;

  constructor(options: DelegationVisualizerOptions = {}) {
    this.name = toOptionalNonEmptyString(options.name);
    this.includeTimestamps = options.includeTimestamps === true;
    this.skipUserMessages = options.skipUserMessages === true;
  }

  render(events: Event[]): string {
    const parts: string[] = [];
    for (const event of events) {
      if (this.skipUserMessages && isMessageEvent(event) && event.source === 'user') continue;
      parts.push(this.renderEvent(event, events));
    }
    return parts.filter(Boolean).join('\n\n---\n\n');
  }

  renderEvent(event: Event, allEvents: Event[]): string {
    const ts = this.includeTimestamps ? formatTimestamp(event) : '';
    if (isSystemPromptEvent(event)) return this.renderSystemPrompt(event, ts);
    if (isMessageEvent(event)) return this.renderMessage(event, ts, allEvents);
    if (isActionEvent(event)) return this.renderAction(event, ts);
    if (isObservationEvent(event)) return this.renderObservation(event, ts);
    return `### ${event.kind}${ts}`;
  }

  private renderSystemPrompt(event: SystemPromptEvent, ts: string): string {
    const agentName = this.formatAgentName(this.name) ?? 'Agent';
    const text = event.system_prompt?.text ?? '';
    return `### ${agentName} Agent System Prompt${ts}\n\n\`\`\`text\n${text.trimEnd()}\n\`\`\`\n`;
  }

  private renderAction(event: ActionEvent, ts: string): string {
    const agentName = this.formatAgentName(this.name) ?? 'Agent';
    return `### ${agentName} Agent Action (${event.tool_name})${ts}`;
  }

  private renderObservation(event: ObservationEvent, ts: string): string {
    const agentName = this.formatAgentName(this.name) ?? 'Agent';
    return `### ${agentName} Agent Observation (${event.tool_name})${ts}`;
  }

  private renderMessage(event: MessageEvent, ts: string, allEvents: Event[]): string {
    const agentName = this.formatAgentName(this.name) ?? 'Agent';
    const role = event.llm_message?.role;
    const sender = toOptionalNonEmptyString((event as MessageEvent & { sender?: unknown }).sender);

    if (role === 'user') {
      const title = sender
        ? `${this.formatAgentName(sender) ?? sender} Agent Message to ${agentName} Agent`
        : `User Message to ${agentName} Agent`;
      return `### ${title}${ts}`;
    }

    const recipient = this.deriveRecipient(allEvents);
    const title = recipient
      ? `${agentName} Agent Message to ${this.formatAgentName(recipient) ?? recipient} Agent`
      : `Message from ${agentName} Agent to User`;
    return `### ${title}${ts}`;
  }

  private deriveRecipient(events: Event[]): string | undefined {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (!isMessageEvent(event)) continue;
      if (event.llm_message?.role !== 'user') continue;
      const sender = toOptionalNonEmptyString((event as MessageEvent & { sender?: unknown }).sender);
      if (sender) return sender;
      return undefined;
    }
    return undefined;
  }

  private formatAgentName(name: string | undefined): string | undefined {
    const trimmed = toOptionalNonEmptyString(name);
    if (!trimmed) return undefined;

    if (trimmed.includes(' ')) return trimmed;
    if (trimmed.includes('_')) return trimmed.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());

    // camelCase/PascalCase -> Title Case
    const spaced = trimmed.replace(/(?<!^)(?=[A-Z])/g, ' ');
    return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

export default DelegationVisualizer;
