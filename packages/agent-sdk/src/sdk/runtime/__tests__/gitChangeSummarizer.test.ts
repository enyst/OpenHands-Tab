import { describe, expect, it } from 'vitest';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../../llm';
import { SecretRegistry } from '../SecretRegistry';
import { summarizeGitChangesWithGeminiFlash } from '../gitChangeSummarizer';

class RecordingLLM implements LLMClient {
  readonly requests: ChatCompletionRequest[] = [];

  constructor(private readonly reply: string) {}

  async *streamChat(request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    this.requests.push(request);
    yield { type: 'text', text: this.reply };
    yield { type: 'finish' };
  }
}

describe('summarizeGitChangesWithGeminiFlash', () => {
  it('masks registered secrets in the prompt and parses structured output', async () => {
    const secrets = new SecretRegistry();
    secrets.set('GEMINI_API_KEY', 'supersecretvalue');

    const llm = new RecordingLLM(
      JSON.stringify({
        overallSummary: 'Updated supersecretvalue handling.',
        fileSummaries: [{ path: 'src/app.ts', summary: 'Removed supersecretvalue from logging.' }],
      }),
    );

    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
    const execFileText = async (command: string, args: string[], cwd?: string) => {
      calls.push({ command, args, cwd });
      if (args[0] !== 'diff') throw new Error(`unexpected command: ${args.join(' ')}`);
      if (args.includes('--name-status')) return 'M\tsrc/app.ts\n';
      return `diff --git a/src/app.ts b/src/app.ts\n+// supersecretvalue\n`;
    };

    const summary = await summarizeGitChangesWithGeminiFlash(
      {
        kind: 'ref_range',
        repoRoot: '/repo',
        fromRef: 'base',
        toRef: 'head',
        pathFilters: ['src/app.ts'],
      },
      { secrets, llmClient: llm, execFileText, maxPromptChars: 50_000 },
    );

    expect(summary).toEqual({
      overallSummary: 'Updated *** handling.',
      fileSummaries: [{ path: 'src/app.ts', summary: 'Removed *** from logging.' }],
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      command: 'git',
      args: ['diff', '--name-status', 'base..head', '--', 'src/app.ts'],
      cwd: '/repo',
    });
    expect(calls[1]).toEqual({
      command: 'git',
      args: ['diff', '--no-color', '--patch', 'base..head', '--', 'src/app.ts'],
      cwd: '/repo',
    });

    expect(llm.requests).toHaveLength(1);
    const prompt = llm.requests[0].messages[0].content[0];
    expect(prompt.type).toBe('text');
    if (prompt.type === 'text') {
      expect(prompt.text).not.toContain('supersecretvalue');
      expect(prompt.text).toContain('***');
      expect(prompt.text).toContain('Changed files (name-status):');
      expect(prompt.text).toContain('M\tsrc/app.ts');
    }
  });

  it('falls back to a plain overallSummary when JSON parsing fails', async () => {
    const secrets = new SecretRegistry();
    secrets.set('GEMINI_API_KEY', 'supersecretvalue');

    const llm = new RecordingLLM('Not JSON supersecretvalue');
    const execFileText = async (_command: string, args: string[]) => {
      if (args.includes('--name-status')) return 'M\tsrc/app.ts\n';
      return 'diff --git a/src/app.ts b/src/app.ts\n';
    };

    const summary = await summarizeGitChangesWithGeminiFlash(
      { kind: 'ref_range', repoRoot: '/repo', fromRef: 'base', toRef: 'head' },
      { secrets, llmClient: llm, execFileText, maxPromptChars: 10_000, maxOverallChars: 50 },
    );

    expect(summary).toEqual({ overallSummary: 'Not JSON ***', fileSummaries: [] });
  });

  it('returns undefined when there are no changes', async () => {
    const secrets = new SecretRegistry();
    const llm = new RecordingLLM('should not be called');
    const execFileText = async () => '';

    const summary = await summarizeGitChangesWithGeminiFlash(
      { kind: 'ref_range', repoRoot: '/repo', fromRef: 'base', toRef: 'head' },
      { secrets, llmClient: llm, execFileText },
    );

    expect(summary).toBeUndefined();
    expect(llm.requests).toHaveLength(0);
  });

  it('clips large diffs and includes the clip marker in the prompt', async () => {
    const secrets = new SecretRegistry();
    const llm = new RecordingLLM(JSON.stringify({ overallSummary: 'OK', fileSummaries: [] }));
    const execFileText = async (_command: string, args: string[]) => {
      if (args.includes('--name-status')) return 'M\tsrc/app.ts\n';
      return `diff --git a/src/app.ts b/src/app.ts\n${'x'.repeat(10_000)}\n`;
    };

    await summarizeGitChangesWithGeminiFlash(
      { kind: 'ref_range', repoRoot: '/repo', fromRef: 'base', toRef: 'head' },
      { secrets, llmClient: llm, execFileText, maxPromptChars: 50_000, maxDiffChars: 50 },
    );

    expect(llm.requests).toHaveLength(1);
    const prompt = llm.requests[0].messages[0].content[0];
    expect(prompt.type).toBe('text');
    if (prompt.type === 'text') {
      expect(prompt.text).toContain('<diff clipped>');
    }
  });
});

