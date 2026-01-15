import type { MessageEvent as AgentMessageEvent } from '@openhands/agent-sdk-ts';
import { isTextContent } from '@openhands/agent-sdk-ts';
import {
  AGENT_ACCENT_COLOR,
  DEFAULT_ACCENT_COLOR,
  EventContainer,
  MarkdownMessage,
  openWorkspaceFile,
  stripEnvironmentInformationBlocks,
  USER_ACCENT_COLOR,
  withAlpha,
} from './shared';


/**
 * Renders chat messages - user and agent messages with context files,
 * images, skills, and extended thinking/content sections.
 */
export function MessageEventBlock({ event, index }: { event: AgentMessageEvent; index?: number }) {
  const message = event.llm_message;
  const isUser = message.role === 'user';
  const isAgent = message.role === 'assistant';

  const rawText = message.content.filter(isTextContent).map((c) => c.text).join('\n');
  const sanitizedText = stripEnvironmentInformationBlocks(rawText);
  const CONTEXT_HEADER = 'User has selected the following files for you to read:';
  function parseContextBlock(text: string): { main: string; files: string[] } {
    const idx = text.lastIndexOf(CONTEXT_HEADER);
    if (idx === -1) return { main: text, files: [] };
    const before = text.slice(0, idx).trimEnd();
    let after = text.slice(idx + CONTEXT_HEADER.length);
    after = after.replace(/^\r?\n/, '');
    const files = after.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    return { main: before, files };
  }
  const { main: withoutContext, files: contextFiles } = parseContextBlock(sanitizedText);

  const ATTACHMENT_BEGIN_LINE_RE = /^-{5,}\s*BEGIN ATTACHMENT:\s*(.*?)\s*-{5,}\s*$/;
  const ATTACHMENT_END_LINE_RE = /^-{5,}\s*END ATTACHMENT:\s*(.*?)\s*-{5,}\s*$/;

  const normalizeAttachmentLabel = (value: string) => value.trim().replace(/\s+/g, ' ');

  function parseAttachmentBlocks(text: string): { main: string; attachments: Array<{ label: string; content: string }> } {
    const attachments: Array<{ label: string; content: string }> = [];
    const mainLines: string[] = [];
    const lines = text.split(/\r?\n/);

    let i = 0;
    while (i < lines.length) {
      const beginLine = lines[i];
      const beginMatch = beginLine.match(ATTACHMENT_BEGIN_LINE_RE);
      if (!beginMatch) {
        mainLines.push(beginLine);
        i += 1;
        continue;
      }

      const label = normalizeAttachmentLabel(beginMatch[1] ?? '') || 'Attachment';

      let endIndex = -1;
      for (let j = i + 1; j < lines.length; j += 1) {
        const endMatch = lines[j].match(ATTACHMENT_END_LINE_RE);
        if (!endMatch) continue;
        const endLabel = normalizeAttachmentLabel(endMatch[1] ?? '') || 'Attachment';
        if (endLabel === label) {
          endIndex = j;
          break;
        }
      }

      if (endIndex === -1) {
        // No matching end marker: treat the begin marker line as normal text and continue scanning.
        mainLines.push(beginLine);
        i += 1;
        continue;
      }

      attachments.push({ label, content: lines.slice(i + 1, endIndex).join('\n').trimEnd() });
      i = endIndex + 1;
    }

    return { main: mainLines.join('\n').trimEnd(), attachments };
  }

  const { main: textContent, attachments } = parseAttachmentBlocks(withoutContext);
  const imageContent = message.content.filter((c) => c.type === 'image');

  const accentColor = isUser ? USER_ACCENT_COLOR : isAgent ? AGENT_ACCENT_COLOR : DEFAULT_ACCENT_COLOR;
  const icon = isUser ? 'account' : isAgent ? 'hubot' : 'info';
  const roleLabel = message.role === 'assistant'
    ? 'OpenHands says'
    : message.role.charAt(0).toUpperCase() + message.role.slice(1);
  const showRoleLabel = !isUser;

  const handleOpenFile = (file: string) => openWorkspaceFile(file);

  // Agent messages use gradient background; user messages use solid background (applied via className)
  const bgOpacity = isAgent ? 0.05 : 0.04;

  return (
    <EventContainer
      accentColor={accentColor}
      bgOpacity={bgOpacity}
      index={index}
      dataTestId="message-event"
      className={isUser ? '!bg-neutral-700' : ''}
      alignRight={isUser}
    >
      <div className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
        {!isUser && (
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center mt-0.5 flex-shrink-0"
            style={{ backgroundColor: withAlpha(accentColor, 10) }}
          >
            <span className={`codicon codicon-${icon} text-sm`} style={{ color: accentColor }} />
          </div>
        )}

        <div className="flex-1 min-w-0">
          {(showRoleLabel || message.created_at) && (
            <div className={`flex items-center gap-2 mb-2 ${isUser ? 'justify-end' : ''}`}>
              {showRoleLabel && (
                <div className={`font-semibold text-sm ${isAgent ? 'text-amber-200' : 'text-stone-300'}`}>{roleLabel}</div>
              )}
              {message.created_at && (
                <div className={`text-xs text-stone-500 ${showRoleLabel ? '' : isUser ? '' : 'ml-auto'}`}>
                  {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
            </div>
          )}

          {textContent && (
            <div className="text-sm leading-relaxed break-words">
              <div className={`${isUser ? 'text-stone-100' : isAgent ? 'text-stone-200' : 'text-stone-300'}`}>
                <MarkdownMessage text={textContent} />
              </div>
            </div>
          )}

          {attachments.length > 0 && (
            <div className="mt-3 pt-3 border-t border-white/[0.06]">
              <div className="mb-2 text-xs text-stone-500 flex items-center gap-2">
                <span className="codicon codicon-file text-brand-400/60" />
                <span>Attachments</span>
              </div>
              <div className="space-y-2">
                {attachments.map((a, idx) => (
                  <details key={`${a.label}-${idx}`} className="bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2">
                    <summary className="cursor-pointer text-xs text-stone-400 hover:text-stone-300 font-mono flex items-center gap-2 transition-colors">
                      <span className="codicon codicon-file text-brand-400/60" />
                      <span className="truncate">{a.label}</span>
                    </summary>
                    <pre className="mt-2 font-mono bg-black/20 border border-white/[0.04] rounded-lg p-3 leading-relaxed text-stone-400 text-xs overflow-auto whitespace-pre-wrap break-words">
                      {a.content}
                    </pre>
                  </details>
                ))}
              </div>
            </div>
          )}

          {isUser && contextFiles.length > 0 && (
            <div className="mt-3 pt-3 border-t border-white/[0.06]">
              <div className="mb-2 text-xs text-stone-500 flex items-center gap-2">
                <span className="codicon codicon-mention" style={{ color: USER_ACCENT_COLOR }} />
                <span>Selected files</span>
              </div>
              <div className="space-y-1">
                {contextFiles.map((file) => (
                  <button
                    key={file}
                    onClick={() => handleOpenFile(file)}
                    className="w-full text-left px-3 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.04] hover:border-white/[0.08] transition-all flex items-center gap-2 font-mono text-xs text-stone-400 group"
                    aria-label={`Open ${file}`}
                    title={`Open ${file}`}
                  >
                    <span className="codicon codicon-file text-brand-400/60" />
                    <span className="truncate flex-1">{file}</span>
                    <span className="codicon codicon-go-to-file opacity-40 group-hover:opacity-70 transition-opacity" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {imageContent.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {imageContent.map((img, idx) => {
                if (img.type === 'image' && img.image_urls) {
                  return img.image_urls.map((url, urlIdx) => (
                    <img
                      key={`${idx}-${urlIdx}`}
                      src={url}
                      alt="Message attachment"
                      className="max-w-xs rounded-lg border border-white/[0.08] shadow-lg"
                    />
                  ));
                }
                return null;
              })}
            </div>
          )}

          {(() => {
            // Use reasoning_content if available (Anthropic/OpenAI Chat Completions),
            // otherwise fall back to responses_reasoning_item.summary (OpenAI Responses API / GPT-5)
            const reasoningContent = message.reasoning_content
              ?? (message.responses_reasoning_item?.summary?.length
                ? message.responses_reasoning_item.summary.join('\n\n')
                : undefined);
            return reasoningContent ? (
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer text-stone-400 hover:text-stone-300 font-medium mb-2 transition-colors">
                  Extended Thinking
                </summary>
                <div className="font-mono bg-black/20 border border-white/[0.04] rounded-lg p-3 mt-2 leading-relaxed text-stone-400">
                  {reasoningContent}
                </div>
              </details>
            ) : null;
          })()}

          {event.activated_skills && event.activated_skills.length > 0 && (
            <div className="mt-3 pt-3 border-t border-white/[0.06] flex flex-wrap gap-2">
              {event.activated_skills.map((skill) => (
                <span
                  key={skill}
                  className="inline-flex items-center px-2.5 py-1 rounded-md text-xs bg-amber-500/15 text-amber-300 border border-amber-400/20"
                >
                  <span className="codicon codicon-mortar-board mr-1.5 text-[10px]" />
                  {skill}
                </span>
              ))}
            </div>
          )}

          {event.extended_content && event.extended_content.length > 0 && (
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer text-stone-400 hover:text-stone-300 font-medium transition-colors">
                Extended Context
              </summary>
              <div className="mt-2 space-y-1">
                {event.extended_content.filter(isTextContent).map((content, idx) => (
                  <pre key={idx} className="bg-black/20 border border-white/[0.04] rounded-lg p-2 font-mono text-stone-400 whitespace-pre-wrap break-words">
                    {content.text}
                  </pre>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
    </EventContainer>
  );
}
