import type { ToolContext, ToolHandler } from './types';
import { requireObject, requireString, optionalString, optionalNumber } from './validation';

export interface BrowserArgs {
  url: string;
  method?: 'GET' | 'POST';
  body?: string;
  maxBytes?: number;
}

export interface BrowserResult {
  url: string;
  status: number;
  content: string;
}

const DEFAULT_MAX_BYTES = 256 * 1024;

export class BrowserTool implements ToolHandler<BrowserArgs, BrowserResult> {
  readonly name = 'browser';

  validate(input: unknown): BrowserArgs {
    const obj = requireObject(input, 'browser args');
    const url = requireString(obj.url, 'url');
    const method = (optionalString(obj.method, 'method') ?? 'GET').toUpperCase();
    if (!['GET', 'POST'].includes(method)) {
      throw new Error('Unsupported HTTP method');
    }
    const body = optionalString(obj.body, 'body');
    const maxBytes = optionalNumber(obj.maxBytes, 'maxBytes');
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Only http and https URLs are allowed');
    }
    return { url: parsed.toString(), method: method as BrowserArgs['method'], body, maxBytes };
  }

  async execute(args: BrowserArgs, _context: ToolContext): Promise<BrowserResult> {
    const parsed = new URL(args.url);

    const controller = new AbortController();
    const maxBytes = args.maxBytes ?? DEFAULT_MAX_BYTES;
    let bytesRead = 0;

    const response = await fetch(parsed, {
      method: args.method ?? 'GET',
      body: args.body,
      signal: controller.signal,
    });

    const reader = response.body?.getReader();
    const chunks: string[] = [];
    if (reader) {
      // Stream chunks while enforcing the maxBytes limit
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          bytesRead += value.byteLength;
          if (bytesRead > maxBytes) {
            controller.abort();
            throw new Error(`Response exceeded limit of ${maxBytes} bytes`);
          }
          chunks.push(new TextDecoder().decode(value));
        }
      }
    }

    const content = chunks.join('');
    return { url: parsed.toString(), status: response.status, content };
  }
}
