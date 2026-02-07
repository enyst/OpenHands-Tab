import * as vscode from 'vscode';

const WORKSPACE_FILES_RETRY_DELAYS_MS = [200, 400] as const;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function listWorkspaceFiles(limit = 500): Promise<string[]> {
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    return [];
  }
  try {
    // Exclude common directories, build artifacts, and all dotfiles/dotdirs
    const excludePattern = '{**/node_modules/**,**/dist/**,**/out/**,**/build/**,**/__pycache__/**,**/coverage/**,**/tmp/**,**/temp/**,**/.*}';
    let uris = await vscode.workspace.findFiles('**/*', excludePattern, limit);
    for (const delayMs of WORKSPACE_FILES_RETRY_DELAYS_MS) {
      if (uris.length > 0) break;
      await sleep(delayMs);
      uris = await vscode.workspace.findFiles('**/*', excludePattern, limit);
    }
    const unique = new Set<string>();
    for (const uri of uris) {
      const relative = vscode.workspace.asRelativePath(uri, false);
      if (relative) {
        unique.add(relative);
      }
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  } catch (err) {
    console.error('[OpenHands] Failed to list workspace files', err);
    return [];
  }
}
