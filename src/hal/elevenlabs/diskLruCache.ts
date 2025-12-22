import * as fs from 'fs/promises';
import * as path from 'path';

type CacheIndex = {
  version: 1;
  entries: Record<string, { bytes: number; at: number }>;
};

const DEFAULT_INDEX: CacheIndex = { version: 1, entries: {} };

function safeJsonParse<T>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export class DiskLruCache {
  private readonly indexPath: string;
  private index: CacheIndex = DEFAULT_INDEX;
  private loaded = false;

  constructor(
    private readonly dir: string,
    private readonly maxBytes: number,
  ) {
    this.indexPath = path.join(dir, 'index.json');
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    await this.ensureLoaded();
    const filePath = this.getEntryPath(key);
    if (!(await fileExists(filePath))) {
      delete this.index.entries[key];
      return undefined;
    }

    const bytes = await fs.readFile(filePath);
    const now = Date.now();
    const existing = this.index.entries[key];
    this.index.entries[key] = { bytes: existing?.bytes ?? bytes.byteLength, at: now };
    await this.saveIndex();
    return new Uint8Array(bytes);
  }

  async set(key: string, data: Uint8Array): Promise<void> {
    await this.ensureLoaded();
    await fs.mkdir(this.dir, { recursive: true });

    const filePath = this.getEntryPath(key);
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmpPath, data);
    await fs.rename(tmpPath, filePath);

    this.index.entries[key] = { bytes: data.byteLength, at: Date.now() };
    await this.prune();
    await this.saveIndex();
  }

  private getEntryPath(key: string): string {
    return path.join(this.dir, `${key}.mp3`);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    await fs.mkdir(this.dir, { recursive: true });
    try {
      const raw = await fs.readFile(this.indexPath, 'utf8');
      const parsed = safeJsonParse<CacheIndex>(raw);
      if (parsed?.version === 1 && parsed.entries && typeof parsed.entries === 'object') {
        this.index = parsed;
      } else {
        this.index = DEFAULT_INDEX;
      }
    } catch {
      this.index = DEFAULT_INDEX;
    }
  }

  private async prune(): Promise<void> {
    if (this.maxBytes <= 0) {
      await this.clearAll();
      return;
    }

    const entries = Object.entries(this.index.entries);
    let total = entries.reduce((sum, [, v]) => sum + (typeof v.bytes === 'number' ? v.bytes : 0), 0);
    if (total <= this.maxBytes) return;

    entries.sort((a, b) => (a[1].at ?? 0) - (b[1].at ?? 0));

    for (const [key, meta] of entries) {
      if (total <= this.maxBytes) break;
      const filePath = this.getEntryPath(key);
      try {
        await fs.rm(filePath, { force: true });
      } catch {}
      delete this.index.entries[key];
      total -= typeof meta.bytes === 'number' ? meta.bytes : 0;
    }
  }

  private async clearAll(): Promise<void> {
    const keys = Object.keys(this.index.entries);
    for (const key of keys) {
      try {
        await fs.rm(this.getEntryPath(key), { force: true });
      } catch {}
      delete this.index.entries[key];
    }
  }

  private async saveIndex(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const tmp = `${this.indexPath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.index), 'utf8');
    await fs.rename(tmp, this.indexPath);
  }
}

