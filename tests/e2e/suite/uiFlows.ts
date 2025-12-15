import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

async function pollUntil(
  condition: () => Promise<boolean>,
  timeoutMs: number = 10000,
  intervalMs: number = 200
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`pollUntil timed out after ${timeoutMs}ms`);
}

export async function run(): Promise<void> {
  await vscode.commands.executeCommand('openhands.open');

  await pollUntil(async () => {
    const diag: any = await vscode.commands.executeCommand('openhands._diagnostics');
    return diag?.chat?.hasView && diag?.chat?.webviewReady;
  }, 15000);

  // Context picker: open and toggle a known file
  const openContextResult: any = await vscode.commands.executeCommand('openhands._webviewAction', { action: 'openContext' });
  if (!openContextResult?.sent) {
    throw new Error(`openContext action was not sent: ${JSON.stringify(openContextResult)}`);
  }

  try {
    await pollUntil(async () => {
      const state: any = await vscode.commands.executeCommand('openhands._queryUiState');
      return state?.showContextPicker === true && typeof state.workspaceFilesCount === 'number';
    }, 15000);
  } catch (err) {
    const diag: any = await vscode.commands.executeCommand('openhands._diagnostics');
    const state: any = await vscode.commands.executeCommand('openhands._queryUiState');
    console.log('diagnosticsOnFailure', diag);
    console.log('uiStateOnFailure', state);
    throw err;
  }

  await vscode.commands.executeCommand('openhands._webviewAction', {
    action: 'toggleContextFile',
    payload: { file: 'README.md' }
  });

  await pollUntil(async () => {
    const state: any = await vscode.commands.executeCommand('openhands._queryUiState');
    return Array.isArray(state?.selectedContextFiles) && state.selectedContextFiles.includes('README.md');
  });

  await vscode.commands.executeCommand('openhands._webviewAction', {
    action: 'toggleContextFile',
    payload: { file: 'README.md' }
  });

  await pollUntil(async () => {
    const state: any = await vscode.commands.executeCommand('openhands._queryUiState');
    return Array.isArray(state?.selectedContextFiles) && !state.selectedContextFiles.includes('README.md');
  });

  // Skills: create a temp skill file and ensure Skills popover loads it
  const skillsDir = path.join(os.homedir(), '.openhands', 'skills');
  await fs.mkdir(skillsDir, { recursive: true });
  const skillPath = path.join(skillsDir, `e2e-skill-${Date.now()}.md`);
  await fs.writeFile(skillPath, '# E2E Skill\n\nHello from e2e.\n', 'utf8');

  try {
    await vscode.commands.executeCommand('openhands._webviewAction', { action: 'openSkills' });

    await pollUntil(async () => {
      const state: any = await vscode.commands.executeCommand('openhands._queryUiState');
      return state?.showSkillsPopover === true && typeof state.skillsCount === 'number' && state.skillsCount >= 1;
    }, 15000);

    await vscode.commands.executeCommand('openhands._webviewAction', { action: 'closeSkills' });

    await pollUntil(async () => {
      const state: any = await vscode.commands.executeCommand('openhands._queryUiState');
      return state?.showSkillsPopover === false;
    });
  } finally {
    await fs.rm(skillPath, { force: true });
  }

  // Attachments: click attachments and rely on E2E_MOCK_ATTACHMENTS to avoid file picker
  await vscode.commands.executeCommand('openhands._webviewAction', { action: 'openAttachments' });

  await pollUntil(async () => {
    const state: any = await vscode.commands.executeCommand('openhands._queryUiState');
    return typeof state?.attachmentsCount === 'number' && state.attachmentsCount >= 1;
  }, 15000);

  console.log('✓ All ui flow tests passed');
}
