import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

/**
 * Downloads VS Code with retry logic to handle transient network errors
 * @param version The VS Code version to download (e.g., 'stable', 'insiders')
 * @param maxRetries Maximum number of retry attempts
 * @param delayMs Delay between retries in milliseconds
 * @returns Path to the downloaded VS Code executable
 */
export async function downloadVSCodeWithRetry(
  version: string = 'stable',
  maxRetries: number = 3,
  delayMs: number = 2000
): Promise<string> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Attempting to download VS Code (attempt ${attempt}/${maxRetries})...`);
      const vscodeExecutablePath = await downloadAndUnzipVSCode(version);
      console.log(`Successfully downloaded VS Code to: ${vscodeExecutablePath}`);
      return vscodeExecutablePath;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`Attempt ${attempt} failed:`, error);

      if (attempt < maxRetries) {
        console.log(`Waiting ${delayMs}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        // Exponential backoff
        delayMs *= 2;
      }
    }
  }

  throw new Error(
    `Failed to download VS Code after ${maxRetries} attempts. Last error: ${lastError?.message}`
  );
}

export async function ensureVsCodeArgvJson(userDataDir: string): Promise<void> {
  const vscodeDir = path.join(userDataDir, '.vscode');
  await fs.mkdir(vscodeDir, { recursive: true });
  await fs.writeFile(path.join(vscodeDir, 'argv.json'), '{}\n', 'utf8');
}

function sanitizeTestNameForPath(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  const cleaned = trimmed.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 16) || 'e2e';
}

export function createE2EUserDataDir(testName: string): string {
  const slug = sanitizeTestNameForPath(testName);
  // Keep basename short to avoid macOS IPC handle path warnings.
  const userDataDir = path.join(os.tmpdir(), `vscode-t-${slug}-${Date.now().toString(36)}`);

  after(async () => {
    await fs.rm(userDataDir, { recursive: true, force: true });
  });

  return userDataDir;
}
