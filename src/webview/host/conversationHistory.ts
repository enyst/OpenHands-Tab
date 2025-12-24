import * as nodeFs from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as readline from 'readline';
import { FileStore, isEvent, isMessageEvent, isTextContent } from '@openhands/agent-sdk-ts';

export type ConversationHistoryItem = {
  id: string;
  timestamp: number;
  firstMessage?: string;
};

const MAX_HISTORY_SCAN_BYTES = 512 * 1024;
const MAX_HISTORY_SCAN_LINES = 2000;

async function findFirstMessageEventLine(eventsPath: string): Promise<string | undefined> {
  const stream = nodeFs.createReadStream(eventsPath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let scannedBytes = 0;
  let scannedLines = 0;

  try {
    for await (const line of rl) {
      scannedLines += 1;
      scannedBytes += Buffer.byteLength(line, 'utf8') + 1;

      if (line.includes('"MessageEvent"')) {
        return line;
      }

      if (scannedLines >= MAX_HISTORY_SCAN_LINES || scannedBytes >= MAX_HISTORY_SCAN_BYTES) {
        return undefined;
      }
    }

    return undefined;
  } finally {
    rl.close();
    stream.destroy();
  }
}

export async function getConversationHistoryList(
  conversationStoreRoot: string,
  outputChannel?: { appendLine(line: string): void }
): Promise<ConversationHistoryItem[]> {
  let ids: string[] = [];
  try {
    ids = FileStore.listConversations(conversationStoreRoot);
  } catch {
    ids = [];
  }

  return Promise.all(
    ids.map(async (id) => {
      try {
        const statePath = path.join(conversationStoreRoot, id, 'state.json');
        const eventsPath = path.join(conversationStoreRoot, id, 'events.jsonl');
        const stat = await fs.stat(statePath).catch(async () => fs.stat(eventsPath));
        const timestamp = stat?.mtimeMs ?? Date.now();
        let firstMessage: string | undefined;
        try {
          const line = await findFirstMessageEventLine(eventsPath);
          if (line) {
            try {
              const parsed: unknown = JSON.parse(line);
              if (isEvent(parsed) && isMessageEvent(parsed)) {
                const msg = parsed.llm_message;
                if (msg.role === 'user') {
                  const textPart = msg.content.find(isTextContent);
                  if (textPart) firstMessage = textPart.text;
                }
              }
            } catch (err) {
              const reason = err instanceof Error ? err.message : String(err);
              outputChannel?.appendLine(`[history] Failed to parse MessageEvent for ${id}: ${reason}`);
            }
          }
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code !== 'ENOENT') {
            const reason = err instanceof Error ? err.message : String(err);
            outputChannel?.appendLine(`[history] Failed to scan events for ${id}: ${reason}`);
          }
        }
        return { id, timestamp: Math.floor(timestamp), firstMessage };
      } catch {
        return { id, timestamp: Date.now() };
      }
    })
  );
}

