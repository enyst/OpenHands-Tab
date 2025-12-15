import * as vscode from 'vscode';

export async function run(): Promise<void> {
  // Ensure chat view is created
  await vscode.commands.executeCommand('openhands.open');

  // Wait until view and webview are ready
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const diag: any = await vscode.commands.executeCommand('openhands._diagnostics');
    if (diag?.chat?.hasView && diag?.chat?.webviewReady) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  // Start fresh conversation
  await vscode.commands.executeCommand('openhands.startNewConversation');
  await new Promise((r) => setTimeout(r, 500));

  // Test 1: Send various message events with different roles
  const messageEvents = [
    // User message
    {
      kind: 'MessageEvent',
      source: 'user',
      llm_message: {
        role: 'user',
        content: [{ type: 'text', text: 'Hello, can you help me with coding?' }]
      }
    },
    // Assistant message with thinking
    {
      kind: 'MessageEvent',
      source: 'agent',
      llm_message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Of course! I\'d be happy to help you with coding. What would you like to work on?' }],
        reasoning_content: 'The user is asking for coding help, I should be friendly and ask for more details.'
      }
    },
    // User follow-up
    {
      kind: 'MessageEvent',
      source: 'user',
      llm_message: {
        role: 'user',
        content: [{ type: 'text', text: 'I need to write a function to sort an array' }]
      }
    }
  ];

  for (const event of messageEvents) {
    await vscode.commands.executeCommand('openhands._sendTestEvent', event);
    await new Promise((r) => setTimeout(r, 100));
  }

  await new Promise((r) => setTimeout(r, 500));

  // Query rendered events
  let result: any = await vscode.commands.executeCommand('openhands._queryRenderedEvents');

  console.log(`After messages - Count: ${result.count}, Types: ${result.eventTypes.join(', ')}`);

  // Verify message events rendered
  const messageCount = result.eventTypes.filter((t: string) => t === 'MessageEvent').length;
  if (messageCount !== 3) {
    throw new Error(`Expected 3 MessageEvents, got ${messageCount}`);
  }

  // Test 2: Send action event with observation
  const actionEvent = {
    kind: 'ActionEvent',
    source: 'agent',
    thought: [{ type: 'text', text: 'I will create a sort function' }],
    action: { command: 'cat sort.js' },
    tool_name: 'terminal',
    tool_call_id: 'call_msg_001',
    tool_call: {
      id: 'call_msg_001',
      type: 'function',
      function: { name: 'terminal', arguments: '{"command":"cat sort.js"}' }
    },
    llm_response_id: 'resp_msg_001',
    security_risk: 'LOW'
  };

  await vscode.commands.executeCommand('openhands._sendTestEvent', actionEvent);
  await new Promise((r) => setTimeout(r, 100));

  // Send corresponding observation
  const observationEvent = {
    kind: 'ObservationEvent',
    source: 'environment',
    observation: {
      content: 'function sort(arr) {\n  return arr.sort((a, b) => a - b);\n}',
      exit_code: 0
    },
    tool_name: 'terminal',
    tool_call_id: 'call_msg_001',
    action_id: 'action_msg_001'
  };

  await vscode.commands.executeCommand('openhands._sendTestEvent', observationEvent);
  await new Promise((r) => setTimeout(r, 500));

  // Query again
  result = await vscode.commands.executeCommand('openhands._queryRenderedEvents');

  console.log(`After action/observation - Count: ${result.count}, Types: ${result.eventTypes.join(', ')}`);

  // Verify action and observation rendered
  const actionCount = result.eventTypes.filter((t: string) => t === 'ActionEvent').length;
  const obsCount = result.eventTypes.filter((t: string) => t === 'ObservationEvent').length;

  if (actionCount < 1) {
    throw new Error(`Expected at least 1 ActionEvent, got ${actionCount}`);
  }
  if (obsCount < 1) {
    throw new Error(`Expected at least 1 ObservationEvent, got ${obsCount}`);
  }

  // Test 3: Send message with multi-part content (text and potential image reference)
  const multiPartMessage = {
    kind: 'MessageEvent',
    source: 'user',
    llm_message: {
      role: 'user',
      content: [
        { type: 'text', text: 'Here is the code I mentioned:' },
        { type: 'text', text: '```javascript\nconsole.log("Hello");\n```' }
      ]
    }
  };

  await vscode.commands.executeCommand('openhands._sendTestEvent', multiPartMessage);
  await new Promise((r) => setTimeout(r, 500));

  result = await vscode.commands.executeCommand('openhands._queryRenderedEvents');
  console.log(`After multi-part message - Count: ${result.count}`);

  // Test 4: Send system prompt event
  const systemPrompt = {
    kind: 'SystemPromptEvent',
    source: 'agent',
    system_prompt: { type: 'text', text: 'You are a helpful coding assistant.' },
    tools: [
      { name: 'terminal', description: 'Execute commands' },
      { name: 'file_editor', description: 'Edit files' }
    ]
  };

  await vscode.commands.executeCommand('openhands._sendTestEvent', systemPrompt);
  await new Promise((r) => setTimeout(r, 500));

  result = await vscode.commands.executeCommand('openhands._queryRenderedEvents');
  console.log(`After system prompt - Count: ${result.count}`);

  const sysPromptCount = result.eventTypes.filter((t: string) => t === 'SystemPromptEvent').length;
  if (sysPromptCount < 1) {
    throw new Error(`Expected at least 1 SystemPromptEvent, got ${sysPromptCount}`);
  }

  // Verify total event count
  if (result.count < 7) {
    throw new Error(`Expected at least 7 total events, got ${result.count}`);
  }

  console.log('✓ All messaging tests passed');
}
