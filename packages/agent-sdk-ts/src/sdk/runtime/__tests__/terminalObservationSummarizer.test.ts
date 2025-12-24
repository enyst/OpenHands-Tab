import { describe, expect, it } from 'vitest';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../../llm';
import { SecretRegistry } from '../SecretRegistry';
import { summarizeTerminalObservationWithGeminiFlash } from '../terminalObservationSummarizer';

class RecordingLLM implements LLMClient {
  readonly requests: ChatCompletionRequest[] = [];

  constructor(private readonly reply: string) {}

  async *streamChat(request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    this.requests.push(request);
    yield { type: 'text', text: this.reply };
    yield { type: 'finish' };
  }
}

class ThrowingLLM implements LLMClient {
  async *streamChat(): AsyncGenerator<LLMStreamChunk> {
    yield { type: 'finish' };
    throw new Error('network disabled');
  }
}

describe('summarizeTerminalObservationWithGeminiFlash', () => {
  it('masks registered secrets in the prompt and output', async () => {
    const secrets = new SecretRegistry();
    secrets.set('GITHUB_TOKEN', 'supersecretvalue');

    const llm = new RecordingLLM('Printed supersecretvalue.');

    const summary = await summarizeTerminalObservationWithGeminiFlash(
      { command: 'echo supersecretvalue', exitCode: 0, stdout: 'supersecretvalue\n', stderr: '' },
      { secrets, llmClient: llm, maxPromptChars: 10_000 }
    );

    expect(summary).toBe('Printed ***.');
    expect(llm.requests).toHaveLength(1);
    const prompt = llm.requests[0].messages[0].content[0];
    expect(prompt.type).toBe('text');
    if (prompt.type === 'text') {
      expect(prompt.text).toContain('Command: echo ***');
      expect(prompt.text).not.toContain('supersecretvalue\n');
      expect(prompt.text).toContain('***');
    }
  });

  it('masks registered secrets even when short', async () => {
    const secrets = new SecretRegistry();
    secrets.set('SHORT_SECRET', 'abc');

    const llm = new RecordingLLM('Printed abc.');
    const summary = await summarizeTerminalObservationWithGeminiFlash(
      { command: 'echo abc', exitCode: 0, stdout: 'abc\n', stderr: '' },
      { secrets, llmClient: llm, maxPromptChars: 10_000 }
    );

    expect(summary).toBe('Printed ***.');
    expect(llm.requests).toHaveLength(1);
    const prompt = llm.requests[0].messages[0].content[0];
    expect(prompt.type).toBe('text');
    if (prompt.type === 'text') {
      expect(prompt.text).not.toContain('abc');
      expect(prompt.text).toContain('***');
    }
  });

  it('falls back to deterministic summary when gemini fails', async () => {
    const secrets = new SecretRegistry();
    const summary = await summarizeTerminalObservationWithGeminiFlash(
      { command: 'git status', exitCode: 2, stdout: '', stderr: 'fatal: not a git repository' },
      { secrets, llmClient: new ThrowingLLM() }
    );

    expect(summary).toBe('Done (exit code 2).');
  });

  it('returns Done when exit code is 0 and gemini returns empty', async () => {
    const secrets = new SecretRegistry();
    const llm = new RecordingLLM('   ');
    const summary = await summarizeTerminalObservationWithGeminiFlash(
      { command: 'pwd', exitCode: 0, stdout: '/tmp\n', stderr: '' },
      { secrets, llmClient: llm }
    );

    expect(summary).toBe('Done.');
  });

  it('never returns more than maxSummaryChars', async () => {
    const secrets = new SecretRegistry();
    const llm = new RecordingLLM('abcdefghij');
    const summary = await summarizeTerminalObservationWithGeminiFlash(
      { command: 'echo hello', exitCode: 0, stdout: 'hello\n', stderr: '' },
      { secrets, llmClient: llm, maxSummaryChars: 5 }
    );

    expect(summary).toBe('abcd…');
    expect(summary.length).toBe(5);
  });

  it('honors maxOutputChars=0 (does not include stdout in prompt)', async () => {
    const secrets = new SecretRegistry();
    const llm = new RecordingLLM('OK');
    await summarizeTerminalObservationWithGeminiFlash(
      { command: 'echo', exitCode: 0, stdout: 'from-stdout\n', stderr: '' },
      { secrets, llmClient: llm, maxOutputChars: 0, maxPromptChars: 10_000 }
    );

    expect(llm.requests).toHaveLength(1);
    const prompt = llm.requests[0].messages[0].content[0];
    expect(prompt.type).toBe('text');
    if (prompt.type === 'text') {
      expect(prompt.text).not.toContain('from-stdout');
      expect(prompt.text).toContain('(empty)');
    }
  });
});
