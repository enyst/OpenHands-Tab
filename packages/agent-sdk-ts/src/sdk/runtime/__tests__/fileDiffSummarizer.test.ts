import { describe, expect, it } from 'vitest';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../../llm';
import { SecretRegistry } from '../SecretRegistry';
import { summarizeFileChangesWithGeminiFlash } from '../fileDiffSummarizer';

class RecordingLLM implements LLMClient {
  readonly requests: ChatCompletionRequest[] = [];

  constructor(private readonly reply: string) {}

  async *streamChat(request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    this.requests.push(request);
    yield { type: 'text', text: this.reply };
    yield { type: 'finish' };
  }
}

describe('summarizeFileChangesWithGeminiFlash', () => {
  it('masks registered secrets in the prompt and output', async () => {
    const secrets = new SecretRegistry();
    secrets.set('OPENAI_API_KEY', 'supersecretvalue');

    const llm = new RecordingLLM('Updated supersecretvalue and added a line.');

    const summary = await summarizeFileChangesWithGeminiFlash(
      {
        kind: 'contents',
        filePath: 'src/example.ts',
        oldContent: 'const KEY = "supersecretvalue";\n',
        newContent: 'const KEY = "supersecretvalue2";\n',
      },
      { secrets, llmClient: llm, maxPromptChars: 10_000 }
    );

    expect(summary).toBe('Updated *** and added a line.');
    expect(llm.requests).toHaveLength(1);
    const prompt = llm.requests[0].messages[0].content[0];
    expect(prompt.type).toBe('text');
    if (prompt.type === 'text') {
      expect(prompt.text).not.toContain('supersecretvalue');
      expect(prompt.text).toContain('***');
    }
  });

  it('loads contents from git refs when requested', async () => {
    const secrets = new SecretRegistry();
    const llm = new RecordingLLM('Replaced a value.');

    const execFileText = async (_command: string, args: string[]) => {
      const selector = args[1];
      if (selector === 'base:src/app.ts') return 'const a = 1;\n';
      if (selector === 'head:src/app.ts') return 'const a = 2;\n';
      throw new Error(`unexpected selector: ${selector}`);
    };

    const summary = await summarizeFileChangesWithGeminiFlash(
      { kind: 'git_refs', repoRoot: '/repo', filePath: 'src/app.ts', baseRef: 'base', headRef: 'head' },
      { secrets, llmClient: llm, execFileText, maxPromptChars: 10_000 }
    );

    expect(summary).toBe('Replaced a value.');
    expect(llm.requests).toHaveLength(1);
    const prompt = llm.requests[0].messages[0].content[0];
    expect(prompt.type).toBe('text');
    if (prompt.type === 'text') {
      expect(prompt.text).toContain('File: src/app.ts');
      expect(prompt.text).toContain('const a = 1;');
      expect(prompt.text).toContain('const a = 2;');
    }
  });

  it('returns undefined when contents are identical', async () => {
    const secrets = new SecretRegistry();
    const llm = new RecordingLLM('should not be called');

    const summary = await summarizeFileChangesWithGeminiFlash(
      { kind: 'contents', filePath: 'src/same.ts', oldContent: 'same', newContent: 'same' },
      { secrets, llmClient: llm }
    );

    expect(summary).toBeUndefined();
    expect(llm.requests).toHaveLength(0);
  });

  it('honors explicit maxSummaryChars=0 (skips summarization)', async () => {
    const secrets = new SecretRegistry();
    const llm = new RecordingLLM('should not be called');

    const summary = await summarizeFileChangesWithGeminiFlash(
      {
        kind: 'contents',
        filePath: 'src/example.ts',
        oldContent: 'const a = 1;\n',
        newContent: 'const a = 2;\n',
      },
      { secrets, llmClient: llm, maxPromptChars: 10_000, maxSummaryChars: 0 }
    );

    expect(summary).toBeUndefined();
    expect(llm.requests).toHaveLength(0);
  });

  it('honors explicit maxPromptChars=0 (skips summarization)', async () => {
    const secrets = new SecretRegistry();
    const llm = new RecordingLLM('should not be called');

    const summary = await summarizeFileChangesWithGeminiFlash(
      {
        kind: 'contents',
        filePath: 'src/example.ts',
        oldContent: 'const a = 1;\n',
        newContent: 'const a = 2;\n',
      },
      { secrets, llmClient: llm, maxPromptChars: 0, maxSummaryChars: 10 }
    );

    expect(summary).toBeUndefined();
    expect(llm.requests).toHaveLength(0);
  });

  it('never returns more than maxSummaryChars', async () => {
    const secrets = new SecretRegistry();
    const llm = new RecordingLLM('abcdefghij');

    const summary = await summarizeFileChangesWithGeminiFlash(
      {
        kind: 'contents',
        filePath: 'src/example.ts',
        oldContent: 'const a = 1;\n',
        newContent: 'const a = 2;\n',
      },
      { secrets, llmClient: llm, maxPromptChars: 10_000, maxSummaryChars: 5 }
    );

    expect(summary).toBe('abcd…');
    expect(summary?.length).toBe(5);
  });

  it('respects maxPromptChars for tiny limits', async () => {
    const secrets = new SecretRegistry();
    const llm = new RecordingLLM('OK');

    await summarizeFileChangesWithGeminiFlash(
      {
        kind: 'contents',
        filePath: 'src/example.ts',
        oldContent: 'old\n',
        newContent: 'new\n',
      },
      { secrets, llmClient: llm, maxPromptChars: 1 }
    );

    expect(llm.requests).toHaveLength(1);
    const prompt = llm.requests[0].messages[0].content[0];
    expect(prompt.type).toBe('text');
    if (prompt.type === 'text') {
      expect(prompt.text.length).toBeLessThanOrEqual(1);
    }
  });

  it('respects maxPromptChars when only the clip marker fits', async () => {
    const secrets = new SecretRegistry();
    const llm = new RecordingLLM('OK');
    const maxPromptChars = '<diff clipped>'.length + 2;

    await summarizeFileChangesWithGeminiFlash(
      {
        kind: 'contents',
        filePath: 'src/example.ts',
        oldContent: 'old\n',
        newContent: 'new\n',
      },
      { secrets, llmClient: llm, maxPromptChars }
    );

    expect(llm.requests).toHaveLength(1);
    const prompt = llm.requests[0].messages[0].content[0];
    expect(prompt.type).toBe('text');
    if (prompt.type === 'text') {
      expect(prompt.text).toContain('<diff clipped>');
      expect(prompt.text.length).toBeLessThanOrEqual(maxPromptChars);
    }
  });

  it('does not truncate summaries up to 5000 characters (oh-tab-qxzs)', async () => {
    const secrets = new SecretRegistry();
    // Create a summary that's close to but under 5000 chars (new default limit)
    // Note: the summarizer trims the result, so we build a string without trailing spaces
    const longSummary = 'The file was updated with new configuration. '.repeat(110).trim(); // ~4950 chars
    const llm = new RecordingLLM(longSummary);

    const summary = await summarizeFileChangesWithGeminiFlash(
      {
        kind: 'contents',
        filePath: 'src/config.ts',
        oldContent: 'const a = 1;\n',
        newContent: 'const a = 2;\n',
      },
      { secrets, llmClient: llm }
    );

    // With default limit of 5000, this should not be truncated
    expect(summary).toBe(longSummary);
    expect(summary.endsWith('…')).toBe(false);
  });
});
