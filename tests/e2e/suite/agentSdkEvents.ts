import * as vscode from 'vscode';

export async function run(): Promise<void> {
  // Ensure panel is created
  await vscode.commands.executeCommand('openhands.openTab');

  // Wait until panel and webview are ready
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const diag: any = await vscode.commands.executeCommand('openhands._diagnostics');
    if (diag?.hasPanel && diag?.webviewReady) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  // Test all agent-sdk event types
  const events = [
    // SystemPromptEvent
    {
      kind: 'SystemPromptEvent',
      source: 'agent',
      system_prompt: { type: 'text', text: 'You are a helpful AI assistant' },
      tools: [
        { name: 'bash', description: 'Execute bash commands' },
        { name: 'read', description: 'Read files' }
      ]
    },

    // ActionEvent - with thought and action
    {
      kind: 'ActionEvent',
      source: 'agent',
      thought: [
        { type: 'text', text: 'I need to check the current directory' }
      ],
      reasoning_content: 'To understand the workspace structure',
      action: { command: 'ls -la' },
      tool_name: 'terminal',
      tool_call_id: 'call_001',
      tool_call: {
        id: 'call_001',
        type: 'function',
        function: { name: 'terminal', arguments: '{"command":"ls -la"}' }
      },
      llm_response_id: 'resp_001',
      security_risk: 'LOW'
    },

    // ActionEvent - with HIGH security risk
    {
      kind: 'ActionEvent',
      source: 'agent',
      thought: [
        { type: 'text', text: 'I will modify system files' }
      ],
      action: { command: 'sudo rm -rf /' },
      tool_name: 'terminal',
      tool_call_id: 'call_002',
      tool_call: {
        id: 'call_002',
        type: 'function',
        function: { name: 'terminal', arguments: '{"command":"sudo rm -rf /"}' }
      },
      llm_response_id: 'resp_002',
      security_risk: 'HIGH'
    },

    // ActionEvent - not executed (action is null)
    {
      kind: 'ActionEvent',
      source: 'agent',
      thought: [
        { type: 'text', text: 'This action was rejected' }
      ],
      action: null,
      tool_name: 'terminal',
      tool_call_id: 'call_003',
      tool_call: {
        id: 'call_003',
        type: 'function',
        function: { name: 'terminal', arguments: '{}' }
      },
      llm_response_id: 'resp_003'
    },

    // ObservationEvent
    {
      kind: 'ObservationEvent',
      source: 'environment',
      observation: {
        content: 'total 48\ndrwxr-xr-x 12 user user 4096 Oct 21 10:30 .\ndrwxr-xr-x  3 user user 4096 Oct 20 15:20 ..',
        exit_code: 0
      },
      tool_name: 'terminal',
      tool_call_id: 'call_001',
      action_id: 'action_001'
    },

    // UserRejectObservation
    {
      kind: 'UserRejectObservation',
      source: 'user',
      rejection_reason: 'This command looks dangerous',
      tool_name: 'terminal',
      tool_call_id: 'call_002',
      action_id: 'action_002'
    },

    // MessageEvent - user message
    {
      kind: 'MessageEvent',
      source: 'user',
      llm_message: {
        role: 'user',
        content: [
          { type: 'text', text: 'Please help me debug this code' }
        ]
      }
    },

    // MessageEvent - assistant message with thinking
    {
      kind: 'MessageEvent',
      source: 'agent',
      llm_message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will help you debug the code. Let me analyze it first.' }
        ],
        reasoning_content: 'The user needs help with debugging, so I should first understand the code structure'
      }
    },

    // MessageEvent - system message
    {
      kind: 'MessageEvent',
      source: 'agent',
      llm_message: {
        role: 'system',
        content: [
          { type: 'text', text: 'System initialized successfully' }
        ]
      }
    },

    // AgentErrorEvent
    {
      kind: 'AgentErrorEvent',
      source: 'agent',
      error: 'Failed to execute command: permission denied',
      tool_name: 'terminal',
      tool_call_id: 'call_004'
    },

    // PauseEvent
    {
      kind: 'PauseEvent',
      source: 'user'
    },

    // Condensation
    {
      kind: 'Condensation',
      source: 'agent',
      forgotten_event_ids: ['event_001', 'event_002', 'event_003'],
      summary: 'Condensed 3 events to save memory'
    },

    // ConversationStateUpdateEvent (should be filtered out but test it anyway)
    {
      kind: 'ConversationStateUpdateEvent',
      source: 'agent',
      agent_status: 'running'
    }
  ];

  // Send each event and wait a bit between them
  for (const event of events) {
    await vscode.commands.executeCommand('openhands._sendTestEvent', event);
    await new Promise((r) => setTimeout(r, 100));
  }

  // Wait for all events to be processed
  await new Promise((r) => setTimeout(r, 1000));

  // Query the webview to verify events were actually rendered
  const result: any = await vscode.commands.executeCommand('openhands._queryRenderedEvents');

  // We expect 12 events rendered (13 sent - 1 ConversationStateUpdateEvent which is filtered out)
  const expectedCount = 12;
  const expectedTypes = [
    'SystemPromptEvent',
    'ActionEvent',
    'ActionEvent',
    'ActionEvent',
    'ObservationEvent',
    'UserRejectObservation',
    'MessageEvent',
    'MessageEvent',
    'MessageEvent',
    'AgentErrorEvent',
    'PauseEvent',
    'Condensation',
    // ConversationStateUpdateEvent is filtered out by the webview
  ];

  if (result.count !== expectedCount) {
    throw new Error(`Expected ${expectedCount} events rendered, got ${result.count}. Event types: ${JSON.stringify(result.eventTypes)}`);
  }

  if (!result.eventTypes || result.eventTypes.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} event types, got ${result.eventTypes?.length || 0}`);
  }

  // Verify all expected event types are present
  for (let i = 0; i < expectedTypes.length; i++) {
    if (result.eventTypes[i] !== expectedTypes[i]) {
      throw new Error(`Expected event type ${expectedTypes[i]} at index ${i}, got ${result.eventTypes[i]}`);
    }
  }

  console.log('✓ All agent-sdk events rendered successfully in webview');
}
