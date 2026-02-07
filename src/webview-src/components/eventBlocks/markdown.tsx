import React, { type ReactNode, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { openMarkdownLink } from './openers';

const collectTextFromNode = (node: ReactNode): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectTextFromNode).join('');
  if (React.isValidElement<{ children?: ReactNode }>(node)) {
    return collectTextFromNode(node.props.children);
  }
  return '';
};

const copyTextToClipboard = async (payload: string) => {
  if (!payload) return;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(payload);
      return;
    }
  } catch {
    // Fall back to execCommand copy.
  }
  const textarea = document.createElement('textarea');
  try {
    textarea.value = payload;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand('copy');
  } catch {
    // Ignore clipboard failures.
  } finally {
    textarea.remove();
  }
};

function CodeBlock({ children }: { children: ReactNode }) {
  const [hideCopy, setHideCopy] = useState(false);
  const codeText = useMemo(() => {
    const raw = collectTextFromNode(children);
    return raw.replace(/\n$/, '');
  }, [children]);
  const shouldShowCopy = codeText.trim().length > 0;
  const handleCopy = () => {
    setHideCopy(true);
    void copyTextToClipboard(codeText);
  };

  return (
    <pre
      className="mt-2 first:mt-0 font-mono bg-black/20 border border-white/[0.04] rounded-lg p-3 pr-10 leading-relaxed text-xs overflow-auto whitespace-pre [&_code]:bg-transparent [&_code]:border-0 [&_code]:px-0 [&_code]:py-0 [&_code]:rounded-none relative group/codeblock"
      onMouseLeave={() => setHideCopy(false)}
    >
      {shouldShowCopy && (
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy code block"
          className={`absolute top-2 right-2 opacity-0 pointer-events-none transition-opacity text-stone-300 hover:text-stone-100 bg-black/30 border border-white/[0.06] rounded-md p-1 shadow-sm ${
            hideCopy ? '' : 'group-hover/codeblock:opacity-100 group-hover/codeblock:pointer-events-auto'
          }`}
        >
          <span className="codicon codicon-copy text-[11px]" />
        </button>
      )}
      {children}
    </pre>
  );
}

export const stripEnvironmentInformationBlocks = (text: string): string => {
  const raw = typeof text === 'string' ? text : '';
  if (!raw) return raw;

  // Only strip legacy env-info blocks when they appear as a trailing suffix.
  // Avoid removing user-authored text that happens to include similar tags mid-message.
  const withoutBlocks = raw.replace(
    /(?:\r?\n){0,2}<environment information>[\s\S]*?<\/environment information>\s*$/i,
    '\n\n',
  );

  // Keep formatting stable after stripping.
  return withoutBlocks.replace(/\n{3,}/g, '\n\n').trimEnd();
};

function MarkdownLink({
  href,
  children,
}: {
  href?: string;
  children: ReactNode;
}) {
  const safeHref = typeof href === 'string' ? href : '';
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        if (!safeHref.trim()) return;
        openMarkdownLink(safeHref);
      }}
      className="text-brand-300 underline decoration-white/20 hover:decoration-white/40 hover:text-brand-200 transition-colors"
    >
      {children}
    </button>
  );
}

const ALLOWED_DATA_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']);
const MAX_DATA_IMAGE_URL_CHARS = 1_000_000;
const ALLOWED_WEBVIEW_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

function isAllowedDataImageUrl(url: string): boolean {
  const trimmed = typeof url === 'string' ? url.trim() : '';
  if (!trimmed.startsWith('data:')) return false;
  if (trimmed.length > MAX_DATA_IMAGE_URL_CHARS) return false;

  const match = /^data:([^;,]+)[;,]/.exec(trimmed);
  const mime = match?.[1]?.toLowerCase();
  if (!mime) return false;
  if (!mime.startsWith('image/')) return false;
  return ALLOWED_DATA_IMAGE_MIME_TYPES.has(mime);
}

function isAllowedWebviewImageUrl(url: string): boolean {
  const trimmed = typeof url === 'string' ? url.trim() : '';
  if (!trimmed) return false;
  if (trimmed.length > MAX_DATA_IMAGE_URL_CHARS) return false;

  const schemeMatch = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.exec(trimmed);
  if (!schemeMatch) return false;

  const scheme = schemeMatch[0].slice(0, -1).toLowerCase();
  if (scheme !== 'vscode-webview-resource' && scheme !== 'vscode-resource' && scheme !== 'vscode-webview') {
    return false;
  }

  const withoutQuery = trimmed.split(/[?#]/)[0].toLowerCase();
  return ALLOWED_WEBVIEW_IMAGE_EXTENSIONS.some((ext) => withoutQuery.endsWith(ext));
}

export function MarkdownMessage({ text }: { text: string }) {
  const safeUrlTransform = (url: string, key?: string) => {
    const trimmed = typeof url === 'string' ? url.trim() : '';
    if (!trimmed) return '';
    if (/^[a-zA-Z]:[\\/]/.test(trimmed)) return trimmed; // Windows absolute path

    const schemeMatch = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.exec(trimmed);
    if (!schemeMatch) return trimmed;

    const scheme = schemeMatch[0].slice(0, -1).toLowerCase();
    if (scheme === 'http' || scheme === 'https' || scheme === 'mailto') return trimmed;
    if (key === 'src') {
      if (scheme === 'data' && isAllowedDataImageUrl(trimmed)) return trimmed;
      if (isAllowedWebviewImageUrl(trimmed)) return trimmed;
    }

    return '';
  };

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      urlTransform={safeUrlTransform}
      components={{
        a: ({ href, children }) => <MarkdownLink href={href}>{children}</MarkdownLink>,
        img: ({ src, alt }) => {
          const cleanSrc = typeof src === 'string' ? src.trim() : '';
          const cleanAlt = typeof alt === 'string' ? alt.trim() : '';
          const label = cleanAlt || cleanSrc || 'image';

          if (!cleanSrc) return <span className="text-stone-400">{label}</span>;

          if (isAllowedDataImageUrl(cleanSrc) || isAllowedWebviewImageUrl(cleanSrc)) {
            return (
              <img
                src={cleanSrc}
                alt={cleanAlt}
                className="max-w-full rounded-lg border border-white/[0.06] shadow-event my-2"
              />
            );
          }

          return <MarkdownLink href={src}>{label}</MarkdownLink>;
        },
        p: ({ children }) => <p className="mt-2 first:mt-0 leading-relaxed">{children}</p>,
        ul: ({ children }) => <ul className="mt-2 first:mt-0 list-disc pl-6 space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="mt-2 first:mt-0 list-decimal pl-6 space-y-1">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        blockquote: ({ children }) => (
          <blockquote className="mt-2 first:mt-0 pl-3 border-l-2 border-white/[0.12] text-stone-300 italic">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="my-3 border-white/[0.08]" />,
        h1: ({ children }) => <h1 className="text-lg font-semibold mt-3 first:mt-0">{children}</h1>,
        h2: ({ children }) => <h2 className="text-base font-semibold mt-3 first:mt-0">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-semibold mt-3 first:mt-0">{children}</h3>,
        pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
        code: ({ className, children }) => (
          <code
            className={[
              'px-1.5 py-0.5 rounded-md bg-black/25 border border-white/[0.06] font-mono text-xs text-stone-200',
              typeof className === 'string' ? className : '',
            ].filter(Boolean).join(' ')}
          >
            {children}
          </code>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
