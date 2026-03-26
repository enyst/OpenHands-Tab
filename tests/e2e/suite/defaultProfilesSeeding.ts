import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { pollUntil } from './pollUntil';

const DEFAULT_PROFILE_IDS = [
  'gemini-flash',
  'gemini-flash-hal',
  'gemini-flash-summarizer',
  'gpt-5',
  'gpt-5-mini',
  'sonnet-45',
] as const;

type LlmProfilesResult = { profiles?: string[] } | undefined;

const getProfilesDir = (): string => {
  const fromEnv = typeof process.env.E2E_LLM_PROFILES_DIR === 'string'
    ? process.env.E2E_LLM_PROFILES_DIR.trim()
    : '';
  if (fromEnv) return path.resolve(fromEnv);

  const fromSdkEnv = typeof process.env.OPENHANDS_LLM_PROFILES_DIR === 'string'
    ? process.env.OPENHANDS_LLM_PROFILES_DIR.trim()
    : '';
  if (fromSdkEnv) return path.resolve(fromSdkEnv);

  return path.join(os.homedir(), '.openhands', 'llm-profiles');
};

const readJson = async (filePath: string): Promise<Record<string, unknown>> => {
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Expected JSON object in ${filePath}`);
  }
  return parsed as Record<string, unknown>;
};

export async function run(): Promise<void> {
  await vscode.commands.executeCommand('openhands.open');

  await pollUntil(async () => {
    const diag = await vscode.commands.executeCommand<{ chat?: { hasView?: boolean; webviewReady?: boolean } }>(
      'openhands._diagnostics',
    );
    return Boolean(diag?.chat?.hasView && diag?.chat?.webviewReady);
  }, 15000);

  // Trigger best-effort default profile seeding in the active store.
  await vscode.commands.executeCommand('openhands._listProfiles');


  // 1) Fresh install: default profiles should be seeded on disk.
  const profilesDir = getProfilesDir();




  await pollUntil(async () => {
    try {
      await fs.access(profilesDir);
    } catch {
      return false;
    }

    const exists = await Promise.all(
      DEFAULT_PROFILE_IDS.map(async (id) => {
        try {
          await fs.access(path.join(profilesDir, `${id}.json`));
          return true;
        } catch {
          return false;
        }
      }),
    );
    return exists.every(Boolean);
  }, 15000);

  for (const id of DEFAULT_PROFILE_IDS) {
    const payload = await readJson(path.join(profilesDir, `${id}.json`));
    assert.strictEqual(typeof payload.provider, 'string');
    assert.strictEqual(typeof payload.model, 'string');
    assert.strictEqual(typeof payload.baseUrl, 'string');
    assert.strictEqual(payload.apiKey, undefined);
    assert.strictEqual(payload.headers, undefined);
  }

  // 2) Source of truth for dropdown: host-side profile list.
  const listed = await vscode.commands.executeCommand<LlmProfilesResult>('openhands._listProfiles');
  const profiles = listed?.profiles;
  if (!Array.isArray(profiles)) throw new Error(`Expected profiles array, got: ${JSON.stringify(listed)}`);
  for (const id of DEFAULT_PROFILE_IDS) {
    assert.ok(profiles.includes(id), `Expected _listProfiles to include '${id}'`);
  }

  // 3) Non-destructive: user customizations to a default profile should not be overwritten.
  const customizedId = 'sonnet-45';
  const customizedPath = path.join(profilesDir, `${customizedId}.json`);
  const before = await readJson(customizedPath);
  const updated = { ...before, model: 'claude-e2e-custom', temperature: 0.123 };
  await fs.writeFile(customizedPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');

  await vscode.commands.executeCommand('openhands._listProfiles');

  const after = await readJson(customizedPath);
  assert.strictEqual(after.model, 'claude-e2e-custom');
  assert.strictEqual(after.temperature, 0.123);

  // 4) Additive: missing default profiles should be recreated (simulates an upgrade adding defaults).
  const missingId = 'gpt-5-mini';
  const missingPath = path.join(profilesDir, `${missingId}.json`);
  await fs.rm(missingPath, { force: true });
  await assert.rejects(() => fs.access(missingPath));

  await vscode.commands.executeCommand('openhands._listProfiles');

  await pollUntil(async () => {
    try {
      await fs.access(missingPath);
      return true;
    } catch {
      return false;
    }
  }, 15000);
}
