import * as vscode from 'vscode';
import { pollUntil } from './pollUntil';

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function assertHalStaysIdle(durationMs: number): Promise<void> {
  const deadline = Date.now() + durationMs;
  while (Date.now() < deadline) {
    const hal: any = await vscode.commands.executeCommand('openhands._queryHalState');
    if (hal?.phase && hal.phase !== 'idle') {
      throw new Error(`Expected HAL phase to remain idle; got ${JSON.stringify(hal)}`);
    }
    await sleep(200);
  }
}

export async function run(): Promise<void> {
  await vscode.commands.executeCommand('openhands.open');

  await pollUntil(async () => {
    const diag: any = await vscode.commands.executeCommand('openhands._diagnostics');
    return Boolean(diag?.chat?.hasView && diag?.chat?.webviewReady);
  }, 15000);

  const cfg = vscode.workspace.getConfiguration();

  // Force local mode (no network), and ensure confirmation events are respected.
  await cfg.update('openhands.serverUrl', '', vscode.ConfigurationTarget.Global);
  await cfg.update('openhands.servers', [], vscode.ConfigurationTarget.Global);
  await cfg.update('openhands.confirmation.policy', 'risky', vscode.ConfigurationTarget.Global);
  await cfg.update('openhands.confirmation.risky.threshold', 'HIGH', vscode.ConfigurationTarget.Global);

  await vscode.commands.executeCommand('openhands.reconnect');
  await vscode.commands.executeCommand('openhands.startNewConversation');

  // Case 1: HAL enabled, but security risk is MEDIUM => HAL should not trigger.
  await cfg.update('openhands.hal.enabled', true, vscode.ConfigurationTarget.Global);
  await cfg.update('openhands.hal.mode', 'bundled', vscode.ConfigurationTarget.Global);

  await pollUntil(async () => {
    const hal: any = await vscode.commands.executeCommand('openhands._queryHalState');
    return hal?.enabled === true && hal?.mode === 'bundled' && hal?.phase === 'idle';
  }, 15000);

  const mediumRiskToolCallId = `call_hal_medium_${Date.now()}`;
  await vscode.commands.executeCommand('openhands._sendTestEvent', {
    kind: 'ActionEvent',
    source: 'agent',
    thought: [{ type: 'text', text: 'Medium-risk action' }],
    action: { command: 'echo medium-risk' },
    tool_name: 'terminal',
    tool_call_id: mediumRiskToolCallId,
    tool_call: {
      id: mediumRiskToolCallId,
      type: 'function',
      function: { name: 'terminal', arguments: '{"command":"echo medium-risk"}' },
    },
    llm_response_id: 'resp_hal_medium',
    security_risk: 'MEDIUM',
  });
  await vscode.commands.executeCommand('openhands._sendTestEvent', {
    kind: 'ConversationStateUpdateEvent',
    source: 'agent',
    agent_status: 'WAITING_FOR_CONFIRMATION',
  });

  await assertHalStaysIdle(2000);

  // Case 2: HAL disabled, but security risk is HIGH => HAL should not trigger.
  await cfg.update('openhands.hal.enabled', false, vscode.ConfigurationTarget.Global);

  await pollUntil(async () => {
    const hal: any = await vscode.commands.executeCommand('openhands._queryHalState');
    return hal?.enabled === false && hal?.phase === 'idle';
  }, 15000);

  const highRiskToolCallId = `call_hal_high_${Date.now()}`;
  await vscode.commands.executeCommand('openhands._sendTestEvent', {
    kind: 'ActionEvent',
    source: 'agent',
    thought: [{ type: 'text', text: 'High-risk action (HAL disabled)' }],
    action: { command: 'echo high-risk' },
    tool_name: 'terminal',
    tool_call_id: highRiskToolCallId,
    tool_call: {
      id: highRiskToolCallId,
      type: 'function',
      function: { name: 'terminal', arguments: '{"command":"echo high-risk"}' },
    },
    llm_response_id: 'resp_hal_high_disabled',
    security_risk: 'HIGH',
  });
  await vscode.commands.executeCommand('openhands._sendTestEvent', {
    kind: 'ConversationStateUpdateEvent',
    source: 'agent',
    agent_status: 'WAITING_FOR_CONFIRMATION',
  });

  await assertHalStaysIdle(2000);
}

