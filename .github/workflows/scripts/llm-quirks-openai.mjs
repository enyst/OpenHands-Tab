#!/usr/bin/env node
/**
 * Test script for OpenAI models with tool calling.
 * 
 * Tests both OpenAI APIs:
 * 1. Chat Completions API (/v1/chat/completions) - via LiteLLM proxy
 * 2. Responses API (/v1/responses) - via direct OpenAI (codex models)
 * 
 * Note: The Responses API is only tested via direct OpenAI because the SDK's
 * OpenAIResponsesClient requires provider='openai' to use the /v1/responses endpoint.
 * LiteLLM proxy uses the chat completions endpoint for all models.
 * 
 * Supports three modes:
 * 1. LiteLLM proxy (default) - tests Chat Completions API via proxy
 * 2. Direct OpenAI API - uses OPENAI_API_KEY with gpt-5-nano (Responses API)
 * 3. All - runs all tests
 * 
 * This script tests the agent-sdk-ts with a simple prompt that requires:
 * 1. Reading a file (tool call)
 * 2. Processing the content
 * 3. Creating a new file (tool call)
 * 4. Confirming completion (text response)
 * 
 * The test ACTUALLY executes file operations to verify end-to-end behavior.
 * 
 * API Documentation:
 * - OpenAI Chat Completions: https://platform.openai.com/docs/api-reference/chat
 * - OpenAI Responses: https://platform.openai.com/docs/api-reference/responses/create
 * - gpt-5-nano: https://platform.openai.com/docs/models/gpt-5-nano
 * 
 * Usage:
 *   # Via LiteLLM proxy (default) - tests Chat Completions API
 *   LITELLM_API_KEY=... node llm-quirks-openai.mjs
 *   
 *   # Direct OpenAI API only (tests Responses API)
 *   OPENAI_API_KEY=... node llm-quirks-openai.mjs --direct
 *   
 *   # Run all tests
 *   LITELLM_API_KEY=... OPENAI_API_KEY=... node llm-quirks-openai.mjs --all
 * 
 * Exit codes:
 *   0 - All tests passed
 *   1 - Test failed
 *   2 - Missing required environment variables
 */

import { LLMFactory } from '../../../packages/agent-sdk-ts/dist/index.mjs';
import { readFile, writeFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Repo root is three levels up from .github/workflows/scripts/
const REPO_ROOT = join(__dirname, '..', '..', '..');
const README_PATH = join(REPO_ROOT, 'README.md');

const LITELLM_BASE_URL = 'https://llm-proxy.eval.all-hands.dev';
// Chat Completions API model via LiteLLM
const LITELLM_CHAT_MODEL = 'openai/gpt-5-nano';
// Direct OpenAI API model (uses Responses API for gpt-5 models)
const OPENAI_MODEL = 'gpt-5-nano';

// Files created during test - will be cleaned up
const TEST_OUTPUT_FILE = 'summary.md';

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

async function streamResponse(client, request) {
  let textContent = '';
  let reasoningContent = '';
  let responsesReasoningItem = null;
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
      case 'responses_reasoning_item':
        // Responses API returns reasoning as a structured item
        responsesReasoningItem = chunk.item;
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

  return { textContent, reasoningContent, responsesReasoningItem, toolCalls, usage };
}

function buildAssistantMessage(result) {
  const msg = {
    role: 'assistant',
    content: result.textContent ? [{ type: 'text', text: result.textContent }] : [],
    tool_calls: Object.values(result.toolCalls).map(tc => ({
      id: tc.id,
      type: 'function',
      function: { name: tc.name, arguments: tc.arguments }
    })),
  };
  // Include responses_reasoning_item for Responses API round-trip
  if (result.responsesReasoningItem) {
    msg.responses_reasoning_item = result.responsesReasoningItem;
  }
  return msg;
}

function buildToolMessages(toolCalls, results) {
  return Object.values(toolCalls).map(tc => ({
    role: 'tool',
    tool_call_id: tc.id,
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
    console.log(`  Tool calls: ${Object.keys(result.toolCalls).length}`);
    if (result.usage) {
      console.log(`  Usage: input=${result.usage.input}, output=${result.usage.output}`);
    }

    // Track what we've seen
    if (Object.keys(result.toolCalls).length > 0) hadToolCalls = true;

    // If no tool calls, we're done
    if (Object.keys(result.toolCalls).length === 0) {
      console.log('\n=== Agent completed (no more tool calls) ===');
      console.log('\nFinal response:');
      console.log(result.textContent);
      break;
    }

    // Process tool calls - ACTUALLY execute them
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
        try {
          if (args.command === 'view') {
            // Map README.md to the actual repo README
            const filePath = args.path === 'README.md' ? README_PATH : args.path;
            const content = await readFile(filePath, 'utf-8');
            toolResults[id] = `File content:\n${content}`;
            console.log(`  Read file: ${args.path} -> ${filePath} (${content.length} chars)`);
          } else if (args.command === 'create') {
            // Actually create the file in cwd
            await writeFile(args.path, args.file_text || '');
            toolResults[id] = `File created successfully at ${args.path}`;
            console.log(`  Created file: ${args.path}`);
            if (args.file_text) {
              console.log(`  Content preview: ${args.file_text.slice(0, 200)}...`);
            }
          } else {
            toolResults[id] = `Command ${args.command} not implemented in test`;
          }
        } catch (err) {
          toolResults[id] = `Error: ${err.message}`;
          console.log(`  Error: ${err.message}`);
        }
      } else {
        toolResults[id] = 'Tool not implemented in test';
      }
    }

    // Build next messages
    const assistantMessage = buildAssistantMessage(result);
    const toolMessages = buildToolMessages(result.toolCalls, toolResults);
    messages = [...messages, assistantMessage, ...toolMessages];
  }

  // Validate results
  const issues = [];
  if (!hadToolCalls) issues.push('No tool calls made');

  // Verify the output file was actually created
  const outputPath = join(process.cwd(), TEST_OUTPUT_FILE);
  console.log(`\n🔍 Checking for output file at: ${outputPath}`);
  
  if (existsSync(outputPath)) {
    const content = await readFile(outputPath, 'utf-8');
    console.log(`📄 Verified ${TEST_OUTPUT_FILE} was created (${content.length} chars)`);
    console.log('--- File content ---');
    console.log(content);
    console.log('--- End of file ---');
    
    // Clean up
    await unlink(outputPath);
    console.log(`🧹 Cleaned up ${TEST_OUTPUT_FILE}`);
  } else {
    console.log(`❌ File NOT found at ${outputPath}`);
    issues.push(`Output file ${TEST_OUTPUT_FILE} was not created`);
  }

  if (turn >= maxTurns && issues.length > 0) {
    console.log('\n=== Max turns reached with issues ===');
    return { success: false, turns: turn, error: 'Max turns reached: ' + issues.join(', ') };
  }

  if (issues.length > 0) {
    console.log('\n⚠️  Issues:');
    issues.forEach(issue => console.log(`  - ${issue}`));
    return { success: false, turns: turn, error: issues.join(', ') };
  }

  console.log(`\n✅ Test "${testName}" completed successfully in ${turn} turns`);
  return { success: true, turns: turn, hadToolCalls };
}

async function main() {
  const args = process.argv.slice(2);
  const runDirect = args.includes('--direct');
  const runAll = args.includes('--all');
  const runLitellm = !runDirect || runAll;
  const runOpenAIDirect = runDirect || runAll;

  const results = [];

  // Test via LiteLLM proxy - Chat Completions API
  if (runLitellm) {
    const litellmKey = process.env.LITELLM_API_KEY;
    if (!litellmKey) {
      console.error('Missing LITELLM_API_KEY environment variable');
      if (!runAll) process.exit(2);
    } else {
      // Chat Completions API via LiteLLM
      const chatConfig = {
        provider: 'litellm_proxy',
        model: LITELLM_CHAT_MODEL,
        baseUrl: LITELLM_BASE_URL,
        apiKey: litellmKey,
        maxOutputTokens: 8000,
      };
      const chatResult = await runTest(chatConfig, `LiteLLM Chat Completions (${LITELLM_CHAT_MODEL})`);
      results.push({ name: 'LiteLLM Chat Completions', ...chatResult });
    }
  }

  // Test direct OpenAI API (uses Responses API for gpt-5 models)
  if (runOpenAIDirect) {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      console.error('Missing OPENAI_API_KEY environment variable');
      if (!runAll) process.exit(2);
    } else {
      const config = {
        provider: 'openai',
        model: OPENAI_MODEL,
        apiKey: openaiKey,
        maxOutputTokens: 8000,
      };
      const result = await runTest(config, `Direct OpenAI Responses API (${OPENAI_MODEL})`);
      results.push({ name: 'Direct OpenAI Responses API', ...result });
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
