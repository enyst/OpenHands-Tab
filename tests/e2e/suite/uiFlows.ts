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
  // Skills: create a temp skill file *before* opening the webview so the initial
  // requestSkills round-trip can populate the badge without opening the popover.
  const skillsDir = path.join(os.homedir(), '.openhands', 'skills');
  await fs.mkdir(skillsDir, { recursive: true });
  const skillPath = path.join(skillsDir, `e2e-skill-${Date.now()}.md`);
  await fs.writeFile(skillPath, '# E2E Skill\n\nHello from e2e.\n', 'utf8');

  await vscode.commands.executeCommand('openhands.open');

  await pollUntil(async () => {
    const diag: any = await vscode.commands.executeCommand('openhands._diagnostics');
    return diag?.chat?.hasView && diag?.chat?.webviewReady;
  }, 15000);

  await pollUntil(async () => {
    const state: any = await vscode.commands.executeCommand('openhands._queryUiState');
    return state?.showSkillsPopover === false && typeof state.skillsCount === 'number' && state.skillsCount >= 1;
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

  // Skills: ensure Skills popover loads the temp skill file
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

  // HAL: Phase 0 bundled flow (no network calls)
  const cfg = vscode.workspace.getConfiguration();
  await cfg.update('openhands.serverUrl', '', vscode.ConfigurationTarget.Global);
  await cfg.update('openhands.servers', [], vscode.ConfigurationTarget.Global);
  await cfg.update('openhands.elevenlabs.enabled', true, vscode.ConfigurationTarget.Global);
  await cfg.update('openhands.elevenlabs.mode', 'bundled', vscode.ConfigurationTarget.Global);

  await pollUntil(async () => {
    const hal: any = await vscode.commands.executeCommand('openhands._queryHalState');
    return hal?.enabled === true && hal?.mode === 'bundled';
  }, 15000);

  const highRiskToolCallId = `call_hal_high_${Date.now()}`;
  await vscode.commands.executeCommand('openhands._sendTestEvent', {
    kind: 'ActionEvent',
    source: 'agent',
    thought: [{ type: 'text', text: 'High-risk action' }],
    action: { command: 'rm -rf /tmp/test' },
    tool_name: 'terminal',
    tool_call_id: highRiskToolCallId,
    tool_call: {
      id: highRiskToolCallId,
      type: 'function',
      function: { name: 'terminal', arguments: '{"command":"rm -rf /tmp/test"}' }
    },
    llm_response_id: 'resp_hal_high',
    security_risk: 'HIGH'
  });
  await vscode.commands.executeCommand('openhands._sendTestEvent', {
    kind: 'ConversationStateUpdateEvent',
    source: 'agent',
    agent_status: 'WAITING_FOR_CONFIRMATION'
  });

  await pollUntil(async () => {
    const hal: any = await vscode.commands.executeCommand('openhands._queryHalState');
    return hal?.phase === 'dialogue';
  }, 15000);

  await pollUntil(async () => {
    const hal: any = await vscode.commands.executeCommand('openhands._queryHalState');
    return hal?.phase === 'awaiting_user';
  }, 15000);

  // Ensure the HAL overlay doesn't restart on repeated state updates.
  await vscode.commands.executeCommand('openhands._sendTestEvent', {
    kind: 'ConversationStateUpdateEvent',
    source: 'agent',
    agent_status: 'WAITING_FOR_CONFIRMATION'
  });
  await new Promise((r) => setTimeout(r, 200));
  const halAfterRepeat: any = await vscode.commands.executeCommand('openhands._queryHalState');
  if (halAfterRepeat?.phase !== 'awaiting_user') {
    throw new Error(`Expected HAL to remain awaiting_user; got ${JSON.stringify(halAfterRepeat)}`);
  }

  // Choose approve deterministically and simulate completion.
  await vscode.commands.executeCommand('openhands._webviewAction', { action: 'halApprove' });
  await vscode.commands.executeCommand('openhands._sendTestEvent', {
    kind: 'ObservationEvent',
    source: 'environment',
    observation: { content: 'ok', exit_code: 0 },
    tool_name: 'terminal',
    tool_call_id: highRiskToolCallId,
    action_id: 'action_hal'
  });
  await vscode.commands.executeCommand('openhands._sendTestEvent', {
    kind: 'ConversationStateUpdateEvent',
    source: 'agent',
    agent_status: 'IDLE'
  });

  await pollUntil(async () => {
    const hal: any = await vscode.commands.executeCommand('openhands._queryHalState');
    return hal?.phase === 'idle';
  }, 15000);

  // Teleport (no servers): should fall back to Reject+reason prompt with a visible error.
  const teleportToolCallId = `call_hal_teleport_${Date.now()}`;
  await vscode.commands.executeCommand('openhands._sendTestEvent', {
    kind: 'ActionEvent',
    source: 'agent',
    thought: [{ type: 'text', text: 'High-risk action (teleport)' }],
    action: { command: 'rm -rf /tmp/test-teleport' },
    tool_name: 'terminal',
    tool_call_id: teleportToolCallId,
    tool_call: {
      id: teleportToolCallId,
      type: 'function',
      function: { name: 'terminal', arguments: '{"command":"rm -rf /tmp/test-teleport"}' }
    },
    llm_response_id: 'resp_hal_teleport',
    security_risk: 'HIGH'
  });
  await vscode.commands.executeCommand('openhands._sendTestEvent', {
    kind: 'ConversationStateUpdateEvent',
    source: 'agent',
    agent_status: 'WAITING_FOR_CONFIRMATION'
  });

  await pollUntil(async () => {
    const hal: any = await vscode.commands.executeCommand('openhands._queryHalState');
    return hal?.phase === 'awaiting_user';
  }, 15000);

  await vscode.commands.executeCommand('openhands._webviewAction', { action: 'halTeleport' });

  await pollUntil(async () => {
    const hal: any = await vscode.commands.executeCommand('openhands._queryHalState');
    return hal?.phase === 'awaiting_user' && typeof hal?.lastError === 'string' && hal.lastError.includes('No server available');
  }, 15000);

  await vscode.commands.executeCommand('openhands._webviewAction', { action: 'halReject' });
  await pollUntil(async () => {
    const hal: any = await vscode.commands.executeCommand('openhands._queryHalState');
    return hal?.decision === 'reject';
  }, 15000);

  await vscode.commands.executeCommand('openhands._sendTestEvent', {
    kind: 'UserRejectObservation',
    source: 'environment',
    rejection_reason: 'E2E reject',
    tool_name: 'terminal',
    tool_call_id: teleportToolCallId,
    action_id: 'action_hal_teleport'
  });
  await vscode.commands.executeCommand('openhands._sendTestEvent', {
    kind: 'ConversationStateUpdateEvent',
    source: 'agent',
    agent_status: 'IDLE'
  });

  await pollUntil(async () => {
    const hal: any = await vscode.commands.executeCommand('openhands._queryHalState');
    return hal?.phase === 'idle';
  }, 15000);

  // Also cover deterministic reject path.
  const rejectToolCallId = `call_hal_reject_${Date.now()}`;
  await vscode.commands.executeCommand('openhands._sendTestEvent', {
    kind: 'ActionEvent',
    source: 'agent',
    thought: [{ type: 'text', text: 'High-risk action (reject)' }],
    action: { command: 'rm -rf /tmp/test-reject' },
    tool_name: 'terminal',
    tool_call_id: rejectToolCallId,
    tool_call: {
      id: rejectToolCallId,
      type: 'function',
      function: { name: 'terminal', arguments: '{"command":"rm -rf /tmp/test-reject"}' }
    },
    llm_response_id: 'resp_hal_reject',
    security_risk: 'HIGH'
  });
  await vscode.commands.executeCommand('openhands._sendTestEvent', {
    kind: 'ConversationStateUpdateEvent',
    source: 'agent',
    agent_status: 'WAITING_FOR_CONFIRMATION'
  });

  await pollUntil(async () => {
    const hal: any = await vscode.commands.executeCommand('openhands._queryHalState');
    return hal?.phase === 'awaiting_user';
  }, 15000);

  await vscode.commands.executeCommand('openhands._webviewAction', { action: 'halReject' });
  await pollUntil(async () => {
    const hal: any = await vscode.commands.executeCommand('openhands._queryHalState');
    return hal?.decision === 'reject';
  }, 15000);

  await vscode.commands.executeCommand('openhands._sendTestEvent', {
    kind: 'UserRejectObservation',
    source: 'environment',
    rejection_reason: 'E2E reject',
    tool_name: 'terminal',
    tool_call_id: rejectToolCallId,
    action_id: 'action_hal_reject'
  });
  await vscode.commands.executeCommand('openhands._sendTestEvent', {
    kind: 'ConversationStateUpdateEvent',
    source: 'agent',
    agent_status: 'IDLE'
  });

  await pollUntil(async () => {
    const hal: any = await vscode.commands.executeCommand('openhands._queryHalState');
    return hal?.phase === 'idle';
  }, 15000);

  console.log('✓ All ui flow tests passed');
}
