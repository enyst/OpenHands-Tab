import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { saveProfile as saveSdkProfile } from '@openhands/agent-sdk-ts';
import { waitForDiagnostics } from './helpers/waitForDiagnostics';
import { pollUntil } from './pollUntil';
import { connectToWebviewCdp } from './helpers/uiHarness';

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

  let closeWebview: (() => Promise<void>) | null = null;

  try {
    await vscode.commands.executeCommand('openhands.open');
    await waitForDiagnostics({
      label: 'chat view ready',
      timeoutMs: 20000,
      predicate: (diag) => Boolean(diag.chat?.hasView && diag.chat?.webviewReady),
    });

    await vscode.commands.executeCommand('workbench.action.focusSideBar');
    await vscode.commands.executeCommand('workbench.view.extension.openhands');
    await vscode.commands.executeCommand('openhands.agent.focus');

    const webview = await connectToWebviewCdp({ port, timeoutMs: 45000 });
    closeWebview = webview.close;

    await webview.waitForSelector('[data-testid="header-totals-row"]', { timeoutMs: 45000, visible: true });

    // Context picker: open, select README.md, close.
    await webview.click('[data-testid="open-context-picker"]');
    await webview.waitForSelector('[data-testid="context-picker"]', { timeoutMs: 15000, visible: true });

    const readmeOptionSelector = '[role="option"][aria-label="README.md"]';
    await webview.waitForSelector(readmeOptionSelector, { timeoutMs: 15000 });
    await webview.click(readmeOptionSelector);

    await pollUntil(
      async () => (await webview.getAttribute(readmeOptionSelector, 'aria-selected')) === 'true',
      15000,
    );

    await webview.click('[data-testid="open-context-picker"]');
    await pollUntil(async () => (await webview.count('[data-testid="context-picker"]')) === 0, 15000);

    // Skills popover: open and ensure skills are listed.
    await webview.click('[data-testid="open-skills-popover"]');
    await webview.waitForSelector('[data-testid="skills-popover"]', { timeoutMs: 15000, visible: true });

    await pollUntil(async () => (await webview.count('[data-testid="skills-popover"] [role="option"]')) >= 1, 15000);

    await webview.click('[data-testid="open-skills-popover"]');
    await pollUntil(async () => (await webview.count('[data-testid="skills-popover"]')) === 0, 15000);

    // Attachments: click and verify mocked attachment renders.
    await webview.click('[data-testid="attachments-button"]');
    await pollUntil(async () => (await webview.count('[aria-label^="Open attachment "]')) >= 1, 15000);

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

    await webview.waitForSelector('[data-testid="confirmation-prompt"]', { timeoutMs: 15000, visible: true });
    await webview.clickByText('button', 'Approve & Continue');

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

    await pollUntil(async () => (await webview.count('[data-testid="confirmation-prompt"]')) === 0, 15000);

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

    await webview.waitForSelector('[data-testid="hal-overlay"]', { timeoutMs: 15000, visible: true });
    await webview.clickByText('button', 'Approve Locally');

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

    await pollUntil(async () => (await webview.count('[data-testid="hal-overlay"]')) === 0, 15000);

    // LLM profiles drawer: open + verify profile list.
    await webview.click('button[aria-label="LLM Profiles"]');
    await webview.waitForSelector('[data-testid="llm-profiles-view"]', { timeoutMs: 15000, visible: true });

    await webview.click('button[aria-label="LLM profile"]');
    const profileOptionSelector = `[role="option"][aria-label="${profileId}"]`;
    await webview.waitForSelector(profileOptionSelector, { timeoutMs: 15000 });

    await webview.click('button[aria-label="LLM profile"]');
    await webview.click('button[aria-label="Close profiles view"]');

    await pollUntil(async () => (await webview.count('[data-testid="llm-profiles-view"]')) === 0, 15000);
  } finally {
    if (closeWebview) {
      await closeWebview();
    }
    await fs.rm(skillPath, { force: true });
    await fs.rm(profilePath, { force: true });
  }
}
