import { describe, expect, it } from 'vitest';
import { OpenHandsTerminalLogPseudoterminal } from '../terminal/OpenHandsTerminalLogPseudoterminal';

function capturePtyWrites(pty: OpenHandsTerminalLogPseudoterminal): () => string {
  const chunks: string[] = [];
  pty.onDidWrite((chunk) => chunks.push(chunk));
  return () => chunks.join('');
}

describe('OpenHandsTerminalLogPseudoterminal', () => {
  it('sanitizes OSC control sequences (BEL terminator)', () => {
    const pty = new OpenHandsTerminalLogPseudoterminal({ renderProgress: false });
    pty.open();
    const getOutput = capturePtyWrites(pty);

    pty.write('hello\u001b]0;title\u0007world\n');

    expect(getOutput()).toBe('helloworld\r\n');
  });

  it('sanitizes OSC control sequences (ST terminator)', () => {
    const pty = new OpenHandsTerminalLogPseudoterminal({ renderProgress: false });
    pty.open();
    const getOutput = capturePtyWrites(pty);

    pty.write('hello\u001b]0;title\u001b\\world\n');

    expect(getOutput()).toBe('helloworld\r\n');
  });

  it('coalesces progress updates (CR) and flushes only the last update on newline', () => {
    const pty = new OpenHandsTerminalLogPseudoterminal();
    pty.open();
    const getOutput = capturePtyWrites(pty);

    pty.write('foo\rbar\rbaz\n');

    expect(getOutput()).toBe('baz\r\n');
  });

  it('strips CSI K (erase-to-EOL) from flushed progress lines', () => {
    const pty = new OpenHandsTerminalLogPseudoterminal();
    pty.open();
    const getOutput = capturePtyWrites(pty);

    pty.write(`Downloading 1%\u001b[K\rDownloading 2%\u001b[2K\n`);

    expect(getOutput()).toBe('Downloading 2%\r\n');
  });

  it('carries incomplete CSI sequences across writes before flushing', () => {
    const pty = new OpenHandsTerminalLogPseudoterminal();
    pty.open();
    const getOutput = capturePtyWrites(pty);

    pty.write(`Downloading \u001b[`);
    pty.write(`2K100%\n`);

    expect(getOutput()).toBe('Downloading 100%\r\n');
  });

  it('buffers output written before open and flushes it on open', () => {
    const pty = new OpenHandsTerminalLogPseudoterminal({ renderProgress: false });
    const getOutput = capturePtyWrites(pty);

    pty.write('hello\n');
    expect(getOutput()).toBe('');

    pty.open();
    expect(getOutput()).toBe('[OpenHands] Terminal log (read-only)\r\nhello\r\n');
  });
});
