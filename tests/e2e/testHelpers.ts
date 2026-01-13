import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import * as fs from 'fs/promises';
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
  await fs.mkdir(path.join(userDataDir, '.vscode'), { recursive: true });
  await fs.writeFile(path.join(userDataDir, '.vscode', 'argv.json'), '{}\n', 'utf8');
}
