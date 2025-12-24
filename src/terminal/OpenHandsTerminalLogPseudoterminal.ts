import * as vscode from 'vscode';

const normalizeTerminalNewlines = (text: string): string => text.replace(/\r?\n/g, '\r\n');

const sanitizeTerminalControlSequences = (text: string): string => {
  if (!text.includes('\u001b')) return text;

  const esc = '\u001b';
  const bel = '\u0007';

  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === esc) {
      const introducer = text[i + 1];
      const isOsc = introducer === ']';
      const isStringSequence = isOsc || introducer === 'P' || introducer === '^' || introducer === '_';

      if (isStringSequence) {
        i += 2; // skip ESC + introducer
        while (i < text.length) {
          const c = text[i];
          if (isOsc && c === bel) {
            i += 1;
            break;
          }
          if (c === esc && text[i + 1] === '\\') {
            i += 2;
            break;
          }
          i += 1;
        }
        continue;
      }
    }

    out += ch;
    i += 1;
  }

  return out;
};

type TerminalLogPseudoterminalOptions = {
  renderProgress: boolean;
};

export class OpenHandsTerminalLogPseudoterminal implements vscode.Pseudoterminal {
  private static readonly PTY_WRITE_CHUNK_SIZE = 16_000;
  private static readonly MAX_PENDING_LINE_CHARS = 200_000;

  private readonly writeEmitter = new vscode.EventEmitter<string>();
  private readonly closeEmitter = new vscode.EventEmitter<void>();
  private closed = false;
  private showedInputHint = false;
  private lastEndedWithNewline = true;
  private readonly renderProgress: boolean;
  private progressCarry = '';
  private progressLine = '';
  private warnedProgressOverflow = false;

  readonly onDidWrite = this.writeEmitter.event;
  readonly onDidClose = this.closeEmitter.event;

  constructor(options?: Partial<TerminalLogPseudoterminalOptions>) {
    this.renderProgress = options?.renderProgress ?? true;
  }

  open(): void {
    this.writeLine('[OpenHands] Terminal log (read-only)');
  }

  close(): void {
    if (this.closed) return;
    if (this.progressLine) {
      this.writeRaw(`${this.sanitizeProgressLine(this.progressLine)}\n`);
      this.progressLine = '';
    }
    this.progressCarry = '';
    this.closed = true;
    this.closeEmitter.fire();
    this.writeEmitter.dispose();
    this.closeEmitter.dispose();
  }

  isClosed(): boolean { return this.closed; }

  ensureNewline(): void {
    if (this.progressLine || this.progressCarry) {
      const line = this.sanitizeProgressLine(this.progressLine);
      this.progressLine = '';
      this.progressCarry = '';
      this.writeRaw(`${line}\n`);
      return;
    }
    if (!this.lastEndedWithNewline) this.writeRaw('\n');
  }

  handleInput(_data: string): void {
    if (this.closed || this.showedInputHint) return;
    this.showedInputHint = true;
    this.writeLine('');
    this.writeLine('[OpenHands] This terminal is read-only.');
    this.writeLine('[OpenHands] Use a normal VS Code terminal for manual commands.');
    this.writeLine('');
  }

  private emitChunk(chunk: string): void {
    if (!chunk) return;
    this.writeEmitter.fire(chunk);
    this.lastEndedWithNewline = /\n$/.test(chunk);
  }

  private writeRaw(text: string): void {
    if (this.closed) return;
    const sanitized = sanitizeTerminalControlSequences(text);
    const normalized = normalizeTerminalNewlines(sanitized);

    const max = OpenHandsTerminalLogPseudoterminal.PTY_WRITE_CHUNK_SIZE;
    let start = 0;
    while (start < normalized.length) {
      let end = Math.min(start + max, normalized.length);

      // Prefer to split on newline boundaries if possible
      const slice = normalized.slice(start, end);
      const lastNl = slice.lastIndexOf('\n');
      if (lastNl > 0 && start + lastNl + 1 < normalized.length) {
        end = start + lastNl + 1;
      }

      // Avoid splitting surrogate pairs
      const prevChar = normalized.charCodeAt(end - 1);
      if (prevChar >= 0xd800 && prevChar <= 0xdbff && end < normalized.length) {
        end -= 1;
      }

      // Avoid cutting off an ANSI CSI sequence (ESC [ ... terminator @-~) at the end of the chunk (best-effort)
      const tail = normalized.slice(start, end);
      const escIdx = tail.lastIndexOf('\u001b[');
      if (escIdx >= 0) {
        const afterCsi = tail.slice(escIdx + 2); // after ESC [
        const hasTerminator = /[@-~]/.test(afterCsi); // CSI typically ends with a byte in @-~
        if (!hasTerminator && escIdx > 0) {
          end = start + escIdx;
        }
      }

      this.emitChunk(normalized.slice(start, end));
      start = end;
    }
  }

  private sanitizeProgressLine(line: string): string {
    // ANSI erase-to-EOL (CSI K) is used by progress bars to clear leftover text.
    // In our coalesced rendering (keeping only last update), the erase is redundant
    // and can be safely removed to keep the log readable.
    if (!line.includes('\u001b[')) return line;

    const esc = '\u001b';
    let out = '';

    for (let i = 0; i < line.length; i++) {
      if (line[i] === esc && line[i + 1] === '[') {
        let j = i + 2;
        while (j < line.length) {
          const code = line.charCodeAt(j);
          const isDigit = code >= 48 && code <= 57;
          const isSemicolon = code === 59;
          if (!isDigit && !isSemicolon) break;
          j += 1;
        }

        if (line[j] === 'K') {
          i = j;
          continue;
        }
      }

      out += line[i];
    }

    return out;
  }

  private splitTrailingIncompleteCsi(text: string): { prefix: string; carry: string } {
    if (!text) return { prefix: '', carry: '' };

    if (text.endsWith('\u001b')) {
      return { prefix: text.slice(0, -1), carry: '\u001b' };
    }

    const escIdx = text.lastIndexOf('\u001b[');
    if (escIdx < 0) return { prefix: text, carry: '' };

    const afterCsi = text.slice(escIdx + 2);
    const hasTerminator = /[@-~]/.test(afterCsi);
    if (hasTerminator) return { prefix: text, carry: '' };

    return { prefix: text.slice(0, escIdx), carry: text.slice(escIdx) };
  }

  private writeWithProgressCoalescing(text: string): void {
    if (this.closed) return;

    // Normalize CRLF -> LF so we can treat standalone CR as progress-only updates.
    const combined = (this.progressCarry + text).replace(/\r\n/g, '\n');
    this.progressCarry = '';

    const { prefix, carry } = this.splitTrailingIncompleteCsi(combined);
    this.progressCarry = carry;
    if (this.progressCarry.length > OpenHandsTerminalLogPseudoterminal.MAX_PENDING_LINE_CHARS) {
      if (!this.warnedProgressOverflow) {
        this.warnedProgressOverflow = true;
        console.warn('[OpenHands] Terminal progress renderer overflowed (carry); flushing to avoid memory growth.');
      }
      this.progressCarry = '';
    }

    const parts = prefix.split('\n');
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;

      const lastCr = part.lastIndexOf('\r');
      if (lastCr >= 0) {
        this.progressLine = part.slice(lastCr + 1);
      } else {
        this.progressLine += part;
      }

      if (!isLast) {
        const line = this.sanitizeProgressLine(this.progressLine);
        this.progressLine = '';
        this.writeRaw(`${line}\n`);
      }
    }

    if (this.progressLine.length > OpenHandsTerminalLogPseudoterminal.MAX_PENDING_LINE_CHARS) {
      const overflow = this.sanitizeProgressLine(this.progressLine);
      this.progressLine = '';
      this.progressCarry = '';
      if (!this.warnedProgressOverflow) {
        this.warnedProgressOverflow = true;
        console.warn('[OpenHands] Terminal progress renderer overflowed; flushing to avoid memory growth.');
      }
      this.writeRaw(`${overflow}\n`);
    }
  }

  write(text: string): void {
    if (!this.renderProgress) {
      this.writeRaw(text);
      return;
    }
    this.writeWithProgressCoalescing(text);
  }

  writeLine(line: string): void {
    this.write(`${line}\n`);
  }
}

