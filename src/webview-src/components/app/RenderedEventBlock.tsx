import {
  isSystemPromptEvent,
  isActionEvent,
  isObservationEvent,
  isUserRejectObservation,
  isMessageEvent,
  isAgentErrorEvent,
  isConversationErrorEvent,
  isPauseEvent,
  isCondensation,
  type Event,
} from '@openhands/agent-sdk-ts';
import {
  SystemPromptEventBlock,
  ActionEventBlock,
  ObservationEventBlock,
  UserRejectBlock,
  AgentErrorBlock,
  ConversationErrorBlock,
  CondensationBlock,
  MessageEventBlock,
} from '../EventBlock';

type RenderedEventBlockProps = {
  event: Event;
  index: number;
  skills: { label: string; path: string }[];
};

/**
 * Event dispatcher: routes agent-sdk events to appropriate rendering components.
 */
export function RenderedEventBlock({ event, index, skills }: RenderedEventBlockProps) {
  if (isSystemPromptEvent(event)) return <SystemPromptEventBlock event={event} index={index} skills={skills} />;
  if (isActionEvent(event)) return <ActionEventBlock event={event} index={index} />;
  if (isObservationEvent(event)) return <ObservationEventBlock event={event} index={index} />;
  if (isUserRejectObservation(event)) return <UserRejectBlock event={event} index={index} />;
  if (isMessageEvent(event)) {
    const message = event.llm_message;
    if (message?.role === 'tool') return null;
    const hasRenderableContent = Array.isArray(message?.content)
      ? message.content.some((item) => {
        if (item.type === 'text') return item.text.trim().length > 0;
        return true;
      })
      : false;
    const hasToolCalls = Array.isArray(message?.tool_calls) && message.tool_calls.length > 0;
    if (message?.role === 'assistant' && hasToolCalls && !hasRenderableContent) {
      return null;
    }
    return <MessageEventBlock event={event} index={index} />;
  }
  if (isAgentErrorEvent(event)) return <AgentErrorBlock event={event} index={index} />;
  if (isConversationErrorEvent(event)) return <ConversationErrorBlock event={event} index={index} />;
  if (isPauseEvent(event)) return null; // Pause events only show in status bar
  if (isCondensation(event)) return <CondensationBlock event={event} index={index} />;

  // Fallback for unknown events
  const safeKind = 'kind' in event && typeof event.kind === 'string' ? event.kind : 'unknown';
  return (
    <div className="bg-white/5 border-l-[3px] border-gray-500 p-4 rounded-lg my-3">
      <div className="font-semibold mb-2">Unknown Event: {String(safeKind)}</div>
      <pre className="font-mono text-xs overflow-auto bg-black/20 p-3 rounded">
        {JSON.stringify(event ?? {}, null, 2)}
      </pre>
    </div>
  );
}
