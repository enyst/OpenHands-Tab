import type { RefObject } from 'react';
import type { Event } from '@openhands/agent-sdk-ts';
import { StreamingMessageBlock } from '../EventBlock';
import { RenderedEventBlock } from './RenderedEventBlock';

type ConversationPaneProps = {
  events: Array<{ id: number; event: Event }>;
  streamingContent: string | null;
  skills: { label: string; path: string }[];
  endRef: RefObject<HTMLDivElement | null>;
};

export function ConversationPane({ events, streamingContent, skills, endRef }: ConversationPaneProps) {
  const isEmptyConversation = events.length === 0 && streamingContent === null;

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4">
      {isEmptyConversation ? (
        <div className="flex flex-col items-center justify-center h-full text-center px-6">
          <div className="text-6xl mb-6">🙌</div>
          <h2 className="text-2xl font-semibold mb-3 text-stone-100">Welcome to OpenHands</h2>
          <p className="text-sm text-stone-400 max-w-md leading-relaxed">
            Start a conversation to collaborate with your AI agent.
          </p>
          <div className="mt-6 flex items-center gap-2 text-xs text-stone-500">
            <span className="codicon codicon-lightbulb text-brand-400" />
            <span>Type a message below to get started</span>
          </div>
        </div>
      ) : (
        <>
          {events.map((ev, index) => (
            <RenderedEventBlock key={ev.id} event={ev.event} index={index} skills={skills} />
          ))}
          {streamingContent !== null && (
            <StreamingMessageBlock content={streamingContent} />
          )}
          <div ref={endRef} />
        </>
      )}
    </div>
  );
}

