#!/usr/bin/env node
/**
 * Test script for claude-haiku-4-5 with extended thinking.
 * 
 * Supports two modes:
 * 1. LiteLLM proxy (default) - uses LITELLM_API_KEY
 * 2. Direct Anthropic API - uses ANTHROPIC_API_KEY
 * 
 * This script tests the agent-sdk-ts with a simple prompt that requires:
 * 1. Reading a file (tool call)
 * 2. Processing the content (thinking)
 * 3. Creating a new file (tool call)
 * 4. Confirming completion (text response)
 * 
 * API Documentation:
 * - Anthropic Messages API: https://platform.claude.com/docs/en/api/messages.md
 * - Extended thinking: https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking
 * 
 * Usage:
 *   # Via LiteLLM proxy (default)
 *   LITELLM_API_KEY=... node test-haiku-thinking.mjs
 *   
 *   # Direct Anthropic API
 *   ANTHROPIC_API_KEY=... node test-haiku-thinking.mjs --direct
 *   
 *   # Run both modes
 *   LITELLM_API_KEY=... ANTHROPIC_API_KEY=... node test-haiku-thinking.mjs --all
 * 
 * Exit codes:
 *   0 - All tests passed
 *   1 - Test failed
 *   2 - Missing required environment variables
 */

import { LLMFactory } from './dist/index.mjs';

const LITELLM_BASE_URL = 'https://llm-proxy.eval.all-hands.dev';
const LITELLM_MODEL = 'anthropic/claude-haiku-4-5';
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20241022';

const fileEditorTool = {
  type: 'function',
  function: {
    name: 'file_editor',
    description: 'Create, view, or edit files',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          enum: ['view', 'create', 'str_replace'],
          description: 'The command to run'
        },
        path: {
          type: 'string',
          description: 'Path to the file'
        },
        file_text: {
          type: 'string',
          description: 'Content for create command'
        }
      },
      required: ['command', 'path']
    }
  }
};

// test README content
const README_CONTENT = `# OpenHands-Tab

A VS Code extension for interacting with OpenHands AI agents directly in your IDE.

## Features

- Chat interface with streaming event display
- Local mode (runs agent in VS Code) or remote mode (connects to agent-server)
- Action confirmation with security risk indicators
- Conversation history and persistence
- Workspace file context and skills support
- Integrated terminal output

## Quick Start

### Prerequisites

- VS Code 1.104.0+
- Node.js >= 22

### Installation

\`\`\`bash
git clone https://github.com/enyst/OpenHands-Tab.git
cd OpenHands-Tab
npm install
npm run build
\`\`\`
`;

async function streamResponse(client, request) {
  let textContent = '';
  let reasoningContent = '';
  let thinkingSignature = '';
  const toolCalls = {};
  let usage = null;

  for await (const chunk of client.streamChat(request)) {
    switch (chunk.type) {
      case 'text':
        textContent += chunk.text;
        process.stdout.write(chunk.text);
        break;
      case 'reasoning':
        reasoningContent += chunk.reasoning;
        break;
      case 'thinking_signature':
        thinkingSignature = chunk.signature;
        break;
      case 'tool_call_delta':
        if (!toolCalls[chunk.id]) {
          toolCalls[chunk.id] = { id: chunk.id, name: chunk.name || '', arguments: '' };
        }
        if (chunk.name) toolCalls[chunk.id].name = chunk.name;
        if (chunk.arguments) toolCalls[chunk.id].arguments += chunk.arguments;
        break;
      case 'usage':
        usage = { input: chunk.inputTokens, output: chunk.outputTokens };
        break;
      case 'finish':
        break;
    }
  }

  return { textContent, reasoningContent, thinkingSignature, toolCalls, usage };
}

function buildAssistantMessage(result) {
  return {
    role: 'assistant',
    content: result.textContent ? [{ type: 'text', text: result.textContent }] : [],
    tool_calls: Object.values(result.toolCalls).map(tc => ({
      id: tc.id,
      type: 'function',
      function: { name: tc.name, arguments: tc.arguments }
    })),
    reasoning_content: result.reasoningContent || undefined,
    thinking_signature: result.thinkingSignature || undefined,
  };
}

function buildToolMessages(toolCalls, results) {
  return Object.values(toolCalls).map(tc => ({
    role: 'tool',
    tool_call_id: tc.id,
    name: tc.name,
    content: [{ type: 'text', text: results[tc.id] || 'Tool executed successfully' }]
  }));
}

/**
 * Run a single test with the given configuration
 * @returns {Promise<{success: boolean, turns: number, error?: string}>}
 */
async function runTest(config, testName) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${testName}`);
  console.log(`Provider: ${config.provider}`);
  console.log(`Model: ${config.model}`);
  if (config.baseUrl) console.log(`Base URL: ${config.baseUrl}`);
  console.log('='.repeat(60));

  let client;
  try {
    console.log('\nCreating LLM client...');
    const factory = new LLMFactory(config);
    client = await factory.createClient();
  } catch (error) {
    console.error(`Failed to create client: ${error.message}`);
    return { success: false, turns: 0, error: `Client creation failed: ${error.message}` };
  }

  const systemPrompt = 'You are a helpful assistant. Use the file_editor tool to read and create files.';
  const userMessage = {
    role: 'user',
    content: [{ type: 'text', text: 'Read the README.md file and find 3 facts to save in summary.md' }]
  };

  let messages = [userMessage];
  let turn = 0;
  const maxTurns = 5;
  let hadThinking = false;
  let hadSignature = false;
  let hadToolCalls = false;

  while (turn < maxTurns) {
    turn++;
    console.log(`\n--- Turn ${turn} ---`);

    const request = {
      systemPrompt,
      messages,
      tools: [fileEditorTool]
    };

    let result;
    try {
      result = await streamResponse(client, request);
    } catch (error) {
      console.error(`\nError during turn ${turn}: ${error.message}`);
      return { success: false, turns: turn, error: error.message };
    }

    console.log('');
    console.log(`  Text: ${result.textContent.length} chars`);
    console.log(`  Reasoning: ${result.reasoningContent.length} chars`);
    console.log(`  Signature: ${result.thinkingSignature ? 'present' : 'missing'}`);
    console.log(`  Tool calls: ${Object.keys(result.toolCalls).length}`);
    if (result.usage) {
      console.log(`  Usage: input=${result.usage.input}, output=${result.usage.output}`);
    }

    // Track what we've seen
    if (result.reasoningContent.length > 0) hadThinking = true;
    if (result.thinkingSignature) hadSignature = true;
    if (Object.keys(result.toolCalls).length > 0) hadToolCalls = true;

    // If no tool calls, we're done
    if (Object.keys(result.toolCalls).length === 0) {
      console.log('\n=== Agent completed (no more tool calls) ===');
      console.log('\nFinal response:');
      console.log(result.textContent);
      break;
    }

    // Process tool calls
    const toolResults = {};
    for (const [id, tc] of Object.entries(result.toolCalls)) {
      let args;
      try {
        args = JSON.parse(tc.arguments);
      } catch {
        args = {};
      }

      console.log(`  Executing: ${tc.name}(${JSON.stringify(args).slice(0, 100)}...)`);

      if (tc.name === 'file_editor') {
        if (args.command === 'view' && args.path === 'README.md') {
          toolResults[id] = `File content:\n${README_CONTENT}`;
        } else if (args.command === 'create') {
          toolResults[id] = `File created successfully at ${args.path}`;
          console.log(`  Created file: ${args.path}`);
          if (args.file_text) {
            console.log(`  Content preview: ${args.file_text.slice(0, 200)}...`);
          }
        } else {
          toolResults[id] = `Command ${args.command} executed on ${args.path}`;
        }
      } else {
        toolResults[id] = 'Tool executed successfully';
      }
    }

    // Build next messages
    const assistantMessage = buildAssistantMessage(result);
    const toolMessages = buildToolMessages(result.toolCalls, toolResults);
    messages = [...messages, assistantMessage, ...toolMessages];
  }

  if (turn >= maxTurns) {
    console.log('\n=== Max turns reached ===');
    return { success: false, turns: turn, error: 'Max turns reached without completion' };
  }

  // Validate results
  const issues = [];
  if (!hadThinking) issues.push('No thinking/reasoning content received');
  if (!hadSignature) issues.push('No thinking signature received');
  if (!hadToolCalls) issues.push('No tool calls made');

  if (issues.length > 0) {
    console.log('\n⚠️  Warnings:');
    issues.forEach(issue => console.log(`  - ${issue}`));
  }

  console.log(`\n✅ Test "${testName}" completed successfully in ${turn} turns`);
  return { success: true, turns: turn, hadThinking, hadSignature, hadToolCalls };
}

async function main() {
  const args = process.argv.slice(2);
  const runDirect = args.includes('--direct');
  const runAll = args.includes('--all');
  const runLitellm = !runDirect || runAll;
  const runAnthropicDirect = runDirect || runAll;

  const results = [];

  // Test via LiteLLM proxy
  if (runLitellm) {
    const litellmKey = process.env.LITELLM_API_KEY;
    if (!litellmKey) {
      console.error('Missing LITELLM_API_KEY environment variable');
      if (!runAll) process.exit(2);
    } else {
      const config = {
        provider: 'litellm_proxy',
        model: LITELLM_MODEL,
        baseUrl: LITELLM_BASE_URL,
        apiKey: litellmKey,
        reasoningEffort: 'low',
        maxOutputTokens: 8000,
      };
      const result = await runTest(config, 'LiteLLM Proxy');
      results.push({ name: 'LiteLLM Proxy', ...result });
    }
  }

  // Test direct Anthropic API
  if (runAnthropicDirect) {
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
      console.error('Missing ANTHROPIC_API_KEY environment variable');
      if (!runAll) process.exit(2);
    } else {
      const config = {
        provider: 'anthropic',
        model: ANTHROPIC_MODEL,
        apiKey: anthropicKey,
        reasoningEffort: 'low',
        maxOutputTokens: 8000,
      };
      const result = await runTest(config, 'Direct Anthropic API');
      results.push({ name: 'Direct Anthropic API', ...result });
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));

  let allPassed = true;
  for (const result of results) {
    const status = result.success ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} - ${result.name} (${result.turns} turns)`);
    if (result.error) {
      console.log(`       Error: ${result.error}`);
    }
    if (!result.success) allPassed = false;
  }

  if (results.length === 0) {
    console.log('No tests were run. Check environment variables.');
    process.exit(2);
  }

  console.log('');
  if (allPassed) {
    console.log('🎉 All tests passed!');
    process.exit(0);
  } else {
    console.log('💥 Some tests failed.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
