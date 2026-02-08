import type { RefObject } from 'react';
import type { Event } from '@smolpaws/agent-sdk';
import { StreamingMessageBlock } from '../EventBlock';
import { RenderedEventBlock } from './RenderedEventBlock';
import { getWelcomePromptFlags, type WelcomeSecretStatus } from './welcomePrompts';

type ConversationPaneProps = {
  events: Array<{ id: number; event: Event }>;
  streamingContent: string | null;
  skills: { label: string; path: string }[];
  endRef: RefObject<HTMLDivElement | null>;
  welcomeSecretStatus: WelcomeSecretStatus;
  onOpenSecretsSettings: () => void;
};

export function ConversationPane({ events, streamingContent, skills, endRef, welcomeSecretStatus, onOpenSecretsSettings }: ConversationPaneProps) {
  const isEmptyConversation = events.length === 0 && streamingContent === null;
  const welcome = getWelcomePromptFlags(welcomeSecretStatus);

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

          {(welcome.showProviderKeyMessage || welcome.showGeminiKeyMessage) && (
            <div className="mt-6 w-full max-w-lg text-left space-y-2">
              {welcome.showProviderKeyMessage && (
                <div className="flex items-start gap-2 text-sm text-stone-300 bg-black/20 border border-white/[0.04] rounded-lg p-3">
                  <span className="codicon codicon-key text-brand-400 mt-0.5" />
                  <div>
                    Please set{' '}
                    <button
                      type="button"
                      onClick={onOpenSecretsSettings}
                      className="underline underline-offset-2 hover:text-stone-100 transition-colors"
                    >
                      an API key
                    </button>{' '}
                    for a provider to start.
                  </div>
                </div>
              )}

              {welcome.showGeminiKeyMessage && (
                <div className="flex items-start gap-2 text-sm text-stone-300 bg-black/20 border border-white/[0.04] rounded-lg p-3">
                  <span className="codicon codicon-star-full text-brand-400 mt-0.5" />
                  <div>
                    Please set a{' '}
                    <button
                      type="button"
                      onClick={onOpenSecretsSettings}
                      className="underline underline-offset-2 hover:text-stone-100 transition-colors"
                    >
                      Gemini (AI Studio) key
                    </button>{' '}
                    for a better experience. OpenHands-Tab will use a Gemini 2.5 Flash profile for tool summarization,
                    remote teleport and other features.
                  </div>
                </div>
              )}
            </div>
          )}
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
