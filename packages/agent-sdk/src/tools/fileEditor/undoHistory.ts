export type UndoEntry = {
  prevExist: boolean;
  oldContent: string | null;
  byteSize: number;
};

const MAX_UNDO_ENTRIES_PER_PATH = 10;
const MAX_UNDO_PATHS = 100;
const MAX_UNDO_BYTES_TOTAL = 100 * 1024 * 1024;

export class UndoHistoryManager {
  private readonly history = new Map<string, UndoEntry[]>();
  private bytesTotal = 0;

  push(path: string, entry: UndoEntry): void {
    const stack = this.history.get(path) ?? [];
    stack.push(entry);
    this.bytesTotal += entry.byteSize;

    while (stack.length > MAX_UNDO_ENTRIES_PER_PATH) {
      const removed = stack.shift();
      if (removed) {
        this.bytesTotal -= removed.byteSize;
      }
    }

    this.history.delete(path);
    this.history.set(path, stack);

    while (this.history.size > MAX_UNDO_PATHS) {
      this.dropOldestPath();
    }

    while (this.bytesTotal > MAX_UNDO_BYTES_TOTAL) {
      if (this.dropOldestPath(path)) continue;
      if (this.dropOldestEntryForPath(path)) continue;
      break;
    }
  }

  peek(path: string): UndoEntry | null {
    const stack = this.history.get(path);
    if (!stack || stack.length === 0) return null;
    return stack[stack.length - 1];
  }

  discardLatest(path: string): void {
    const stack = this.history.get(path);
    if (!stack || stack.length === 0) return;

    const removed = stack.pop();
    if (removed) {
      this.bytesTotal -= removed.byteSize;
    }

    if (stack.length === 0) {
      this.history.delete(path);
    }
  }

  private dropOldestPath(excludePath?: string): boolean {
    for (const key of this.history.keys()) {
      if (excludePath && key === excludePath) continue;

      const stack = this.history.get(key);
      if (stack) {
        for (const entry of stack) {
          this.bytesTotal -= entry.byteSize;
        }
      }
      this.history.delete(key);
      return true;
    }
    return false;
  }

  private dropOldestEntryForPath(path: string): boolean {
    const stack = this.history.get(path);
    if (!stack || stack.length <= 1) return false;

    const lastIndex = stack.length - 1;
    const index = stack.slice(0, lastIndex).findIndex((entry) => entry.byteSize > 0);
    if (index === -1) return false;

    const [removed] = stack.splice(index, 1);
    this.bytesTotal -= removed.byteSize;
    return true;
  }
}

export const exceedsUndoHistorySizeCap = (undoByteSize: number): boolean => undoByteSize > MAX_UNDO_BYTES_TOTAL;
