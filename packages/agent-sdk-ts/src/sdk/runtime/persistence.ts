import fs from 'fs';
import path from 'path';
import type { AgentState } from './ConversationState';
import type { Event } from '../types';

export interface ConversationPersistence {
  conversationId: string;
  appendEvent(event: Event): void;
  readEvents(): Event[];
  writeState(state: AgentState): void;
  readState(): AgentState | undefined;
}

export interface FileStoreOptions {
  rootDir?: string;
  conversationId: string;
}

export class FileStore implements ConversationPersistence {
  readonly rootDir: string;
  readonly conversationId: string;
  private readonly conversationDir: string;
  private readonly eventsFile: string;
  private readonly stateFile: string;

  constructor(options: FileStoreOptions) {
    this.rootDir = options.rootDir ?? path.join(process.cwd(), '.openhands', 'conversations');
    this.conversationId = options.conversationId;
    this.conversationDir = path.join(this.rootDir, this.conversationId);
    this.eventsFile = path.join(this.conversationDir, 'events.jsonl');
    this.stateFile = path.join(this.conversationDir, 'state.json');
    fs.mkdirSync(this.conversationDir, { recursive: true });
  }

  appendEvent(event: Event): void {
    fs.appendFileSync(this.eventsFile, `${JSON.stringify(event)}\n`, 'utf8');
  }

  readEvents(): Event[] {
    if (!fs.existsSync(this.eventsFile)) return [];
    const content = fs.readFileSync(this.eventsFile, 'utf8');
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Event);
  }

  writeState(state: AgentState): void {
    fs.writeFileSync(this.stateFile, JSON.stringify(state), 'utf8');
  }

  readState(): AgentState | undefined {
    if (!fs.existsSync(this.stateFile)) return undefined;
    return JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) as AgentState;
  }

  static listConversations(rootDir?: string): string[] {
    const dir = rootDir ?? path.join(process.cwd(), '.openhands', 'conversations');
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  }
}
