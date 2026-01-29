import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { saveProfile as saveSdkProfile } from '@openhands/agent-sdk-ts';
import type { Page } from 'playwright-core';
import { waitForDiagnostics } from './helpers/waitForDiagnostics';
import { pollUntil } from './pollUntil';
import { connectToVsCodeUi } from './helpers/uiHarness';

async function tryActivateOpenHandsView(page: Page): Promise<void> {
  try {
    const button = page.locator('[role="button"][aria-label*="OpenHands"]');
    if (await button.count()) {
      await button.first().click({ timeout: 2000 });
    }
  } catch {
    // Best-effort only; the view is also opened via command.
  }
}

export async function run(): Promise<void> {
  if (process.env.E2E_UI !== '1') return;

  const portRaw = process.env.E2E_CDP_PORT;
  const port = portRaw ? Number(portRaw) : 0;
  if (!port) {
    throw new Error('E2E_CDP_PORT is required for UI flows');
  }

  const skillsDir = path.join(os.homedir(), '.openhands', 'skills');
  const llmProfilesDir = path.join(os.homedir(), '.openhands', 'llm-profiles');
  const skillPath = path.join(skillsDir, `e2e-ui-skill-${Date.now()}.md`);
  const profileId = `e2e-ui-${Date.now()}`;
  const profilePath = path.join(llmProfilesDir, `${profileId}.json`);

  await fs.mkdir(skillsDir, { recursive: true });
  await fs.writeFile(skillPath, '# E2E UI Skill\n\nHello from UI E2E.\n', 'utf8');

  await fs.mkdir(llmProfilesDir, { recursive: true });
  saveSdkProfile(profileId, { model: 'gpt-5-mini' }, { rootDir: llmProfilesDir, includeSecrets: false });

  let closeBrowser: (() => Promise<void>) | null = null;

  try {
    await vscode.commands.executeCommand('openhands.open');
    await waitForDiagnostics({
      label: 'chat view ready',
      timeoutMs: 20000,
      predicate: (diag) => Boolean(diag.chat?.hasView && diag.chat?.webviewReady),
    });

    const { page, webview, close } = await connectToVsCodeUi({
      port,
      timeoutMs: 30000,
      webviewSelector: 'iframe.webview[src*="openhands.openhands-tab"]',
    });
    closeBrowser = close;

    await vscode.commands.executeCommand('workbench.action.focusSideBar');
    await vscode.commands.executeCommand('workbench.view.extension.openhands');
    await vscode.commands.executeCommand('openhands.agent.focus');
    await tryActivateOpenHandsView(page);
    await webview.locator('[data-testid="header-totals-row"]').waitFor({ state: 'visible', timeout: 45000 });

    // Context picker: open, select README.md, close.
    const contextButton = webview.locator('[data-testid="open-context-picker"]');
    await contextButton.click();
    await webview.locator('[data-testid="context-picker"]').waitFor({ state: 'visible', timeout: 15000 });

    const readmeOption = webview.getByRole('option', { name: 'README.md' });
    await readmeOption.waitFor({ state: 'visible', timeout: 15000 });
    await readmeOption.click();

    await pollUntil(async () => (await readmeOption.getAttribute('aria-selected')) === 'true', 15000);

    await contextButton.click();
    await pollUntil(async () => (await webview.locator('[data-testid="context-picker"]').count()) === 0, 15000);

    // Skills popover: open and ensure skills are listed.
    const skillsButton = webview.locator('[data-testid="open-skills-popover"]');
    await skillsButton.click();
    await webview.locator('[data-testid="skills-popover"]').waitFor({ state: 'visible', timeout: 15000 });

    await pollUntil(async () => (await webview.locator('[data-testid="skills-popover"] [role="option"]').count()) >= 1, 15000);

    await skillsButton.click();
    await pollUntil(async () => (await webview.locator('[data-testid="skills-popover"]').count()) === 0, 15000);

    // Attachments: click and verify mocked attachment renders.
    const attachmentsButton = webview.locator('[data-testid="attachments-button"]');
    await attachmentsButton.click();
    await pollUntil(async () => (await webview.locator('[aria-label^="Open attachment "]').count()) >= 1, 15000);

    // Confirmation prompt: approve.
    const cfg = vscode.workspace.getConfiguration();
    await cfg.update('openhands.hal.enabled', false, vscode.ConfigurationTarget.Global);
    await cfg.update('openhands.confirmation.policy', 'always', vscode.ConfigurationTarget.Global);

    const confirmationCallId = `call_ui_confirm_${Date.now()}`;
    await vscode.commands.executeCommand('openhands._sendTestEvent', {
      kind: 'ActionEvent',
      source: 'agent',
      thought: [{ type: 'text', text: 'Needs approval' }],
      action: { command: 'echo confirm' },
      tool_name: 'terminal',
      tool_call_id: confirmationCallId,
      tool_call: {
        id: confirmationCallId,
        type: 'function',
        function: { name: 'terminal', arguments: '{"command":"echo confirm"}' },
      },
      llm_response_id: 'resp_ui_confirm',
      security_risk: 'MEDIUM',
    });
    await vscode.commands.executeCommand('openhands._sendTestEvent', {
      kind: 'ConversationStateUpdateEvent',
      source: 'agent',
      agent_status: 'WAITING_FOR_CONFIRMATION',
    });

    await webview.locator('[data-testid="confirmation-prompt"]').waitFor({ state: 'visible', timeout: 15000 });
    await webview.getByRole('button', { name: 'Approve & Continue' }).click();

    await vscode.commands.executeCommand('openhands._sendTestEvent', {
      kind: 'ObservationEvent',
      source: 'environment',
      observation: { content: 'ok', exit_code: 0 },
      tool_name: 'terminal',
      tool_call_id: confirmationCallId,
      action_id: 'action_ui_confirm',
    });
    await vscode.commands.executeCommand('openhands._sendTestEvent', {
      kind: 'ConversationStateUpdateEvent',
      source: 'agent',
      agent_status: 'IDLE',
    });

    await pollUntil(async () => (await webview.locator('[data-testid="confirmation-prompt"]').count()) === 0, 15000);

    // HAL overlay: approve locally.
    await cfg.update('openhands.serverUrl', '', vscode.ConfigurationTarget.Global);
    await cfg.update('openhands.servers', [], vscode.ConfigurationTarget.Global);
    await cfg.update('openhands.hal.enabled', true, vscode.ConfigurationTarget.Global);
    await cfg.update('openhands.hal.mode', 'bundled', vscode.ConfigurationTarget.Global);
    await cfg.update('openhands.confirmation.policy', 'risky', vscode.ConfigurationTarget.Global);
    await cfg.update('openhands.confirmation.risky.threshold', 'HIGH', vscode.ConfigurationTarget.Global);

    await pollUntil(async () => {
      const hal: any = await vscode.commands.executeCommand('openhands._queryHalState');
      return hal?.enabled === true && hal?.mode === 'bundled';
    }, 15000);

    const halCallId = `call_ui_hal_${Date.now()}`;
    await vscode.commands.executeCommand('openhands._sendTestEvent', {
      kind: 'ActionEvent',
      source: 'agent',
      thought: [{ type: 'text', text: 'High-risk action' }],
      action: { command: 'rm -rf /tmp/test' },
      tool_name: 'terminal',
      tool_call_id: halCallId,
      tool_call: {
        id: halCallId,
        type: 'function',
        function: { name: 'terminal', arguments: '{"command":"rm -rf /tmp/test"}' },
      },
      llm_response_id: 'resp_ui_hal',
      security_risk: 'HIGH',
    });
    await vscode.commands.executeCommand('openhands._sendTestEvent', {
      kind: 'ConversationStateUpdateEvent',
      source: 'agent',
      agent_status: 'WAITING_FOR_CONFIRMATION',
    });

    await webview.locator('[data-testid="hal-overlay"]').waitFor({ state: 'visible', timeout: 15000 });
    await webview.getByRole('button', { name: 'Approve Locally' }).click();

    await vscode.commands.executeCommand('openhands._sendTestEvent', {
      kind: 'ObservationEvent',
      source: 'environment',
      observation: { content: 'ok', exit_code: 0 },
      tool_name: 'terminal',
      tool_call_id: halCallId,
      action_id: 'action_ui_hal',
    });
    await vscode.commands.executeCommand('openhands._sendTestEvent', {
      kind: 'ConversationStateUpdateEvent',
      source: 'agent',
      agent_status: 'IDLE',
    });

    await pollUntil(async () => (await webview.locator('[data-testid="hal-overlay"]').count()) === 0, 15000);

    // LLM profiles drawer: open + verify profile list.
    await webview.getByRole('button', { name: 'LLM Profiles' }).click();
    await webview.locator('[data-testid="llm-profiles-view"]').waitFor({ state: 'visible', timeout: 15000 });

    const profileSelect = webview.getByRole('button', { name: 'Profile' });
    await profileSelect.click();

    await webview.getByRole('option', { name: profileId }).waitFor({ state: 'visible', timeout: 15000 });

    await profileSelect.click();
    await webview.getByRole('button', { name: 'Close profiles view' }).click();

    await pollUntil(async () => (await webview.locator('[data-testid="llm-profiles-view"]').count()) === 0, 15000);
  } finally {
    if (closeBrowser) {
      await closeBrowser();
    }
    await fs.rm(skillPath, { force: true });
    await fs.rm(profilePath, { force: true });
  }
}
