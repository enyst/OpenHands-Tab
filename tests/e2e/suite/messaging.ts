import * as vscode from 'vscode';
import { pollUntil } from './pollUntil';

export async function run(): Promise<void> {
  // Ensure chat view is created
  await vscode.commands.executeCommand('openhands.open');

  // Wait until view and webview are ready
  await pollUntil(async () => {
    const diag: any = await vscode.commands.executeCommand('openhands._diagnostics');
    return diag?.chat?.hasView && diag?.chat?.webviewReady;
  }, 15000);

  // Start fresh conversation
  await vscode.commands.executeCommand('openhands.startNewConversation');
  await pollUntil(async () => {
    const d: any = await vscode.commands.executeCommand('openhands._diagnostics');
    return d?.chat?.webviewReady;
  });

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
  }

  // Poll until message events are rendered
  await pollUntil(async () => {
    const result: any = await vscode.commands.executeCommand('openhands._queryRenderedEvents');
    const msgCount = result?.eventTypes?.filter((t: string) => t === 'MessageEvent').length || 0;
    return msgCount >= messageEvents.length;
  });

  // Query rendered events
  let result: any = await vscode.commands.executeCommand('openhands._queryRenderedEvents');

  console.log(`After messages - Count: ${result.count}, Types: ${result.eventTypes.join(', ')}`);

  // Verify message events rendered
  const messageCount = result.eventTypes.filter((t: string) => t === 'MessageEvent').length;
  if (messageCount !== messageEvents.length) {
    throw new Error(`Expected ${messageEvents.length} MessageEvents, got ${messageCount}`);
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

  // Poll until action and observation are rendered
  await pollUntil(async () => {
    const r: any = await vscode.commands.executeCommand('openhands._queryRenderedEvents');
    const actionCount = r?.eventTypes?.filter((t: string) => t === 'ActionEvent').length || 0;
    const obsCount = r?.eventTypes?.filter((t: string) => t === 'ObservationEvent').length || 0;
    return actionCount >= 1 && obsCount >= 1;
  });

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

  const expectedMessagesAfterMultiPart = messageEvents.length + 1;

  // Poll until multi-part message is rendered
  await pollUntil(async () => {
    const r: any = await vscode.commands.executeCommand('openhands._queryRenderedEvents');
    const msgCount = r?.eventTypes?.filter((t: string) => t === 'MessageEvent').length || 0;
    return msgCount >= expectedMessagesAfterMultiPart;
  });

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

  // Poll until system prompt is rendered
  await pollUntil(async () => {
    const r: any = await vscode.commands.executeCommand('openhands._queryRenderedEvents');
    const sysCount = r?.eventTypes?.filter((t: string) => t === 'SystemPromptEvent').length || 0;
    return sysCount >= 1;
  });

  result = await vscode.commands.executeCommand('openhands._queryRenderedEvents');
  console.log(`After system prompt - Count: ${result.count}`);

  const sysPromptCount = result.eventTypes.filter((t: string) => t === 'SystemPromptEvent').length;
  if (sysPromptCount < 1) {
    throw new Error(`Expected at least 1 SystemPromptEvent, got ${sysPromptCount}`);
  }

  // Verify total event count: messages + action + observation + multipart + system prompt
  const expectedTotalEvents = messageEvents.length + 1 + 1 + 1 + 1;
  if (result.count < expectedTotalEvents) {
    throw new Error(`Expected at least ${expectedTotalEvents} total events, got ${result.count}`);
  }

  console.log('✓ All messaging tests passed');
}
