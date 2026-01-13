import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { getConversationHistoryList, persistConversationTitle } from '../conversationHistory';

const writeJson = async (filePath: string, value: unknown) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value), 'utf8');
};

describe('conversationHistory', () => {
  let tmpRoot: string | undefined;

  afterEach(async () => {
    if (tmpRoot) {
      await fs.rm(tmpRoot, { recursive: true, force: true });
      tmpRoot = undefined;
    }
  });

  it('includes contextTokens from state.values.llm_usage when present', async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'oh-tab-history-'));
    const id = 'local-test-1';
    const dir = path.join(tmpRoot, id);

    await writeJson(path.join(dir, 'state.json'), {
      status: 'idle',
      iteration: 0,
      values: { llm_usage: { input: 123 } },
    });
    await fs.writeFile(
      path.join(dir, 'events.jsonl'),
      `${JSON.stringify({
        kind: 'MessageEvent',
        llm_message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      })}\n`,
      'utf8'
    );

    const outputChannel = { appendLine: vi.fn() };
    const items = await getConversationHistoryList(tmpRoot, outputChannel);
    const item = items.find((x) => x.id === id);
    expect(item).toBeTruthy();
    expect(item?.contextTokens).toBe(123);
  });

  it('falls back to stats when llm_usage is missing', async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'oh-tab-history-'));
    const id = 'local-test-2';
    const dir = path.join(tmpRoot, id);

    await writeJson(path.join(dir, 'state.json'), {
      status: 'idle',
      iteration: 0,
      values: {
        stats: {
          usage_to_metrics: {
            agent: { lastTokenUsage: { promptTokens: 77 } },
          },
        },
      },
    });
    await fs.writeFile(path.join(dir, 'events.jsonl'), '', 'utf8');

    const items = await getConversationHistoryList(tmpRoot);
    const item = items.find((x) => x.id === id);
    expect(item).toBeTruthy();
    expect(item?.contextTokens).toBe(77);
  });

  it('reads persisted titles from conversation.json and can persist new titles', async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'oh-tab-history-'));
    const id = 'local-test-3';
    const dir = path.join(tmpRoot, id);

    await writeJson(path.join(dir, 'state.json'), { status: 'idle', iteration: 0, values: {} });
    await writeJson(path.join(dir, 'conversation.json'), { title: 'Existing title' });
    await fs.writeFile(path.join(dir, 'events.jsonl'), '', 'utf8');

    const initial = await getConversationHistoryList(tmpRoot);
    expect(initial.find((x) => x.id === id)?.title).toBe('Existing title');

    await persistConversationTitle(tmpRoot, id, 'New title');
    const updated = await getConversationHistoryList(tmpRoot);
    expect(updated.find((x) => x.id === id)?.title).toBe('New title');
  });
});

