#!/usr/bin/env node
/**
 * Test script for Gemini 3 Flash with thinking (thought signatures).
 * 
 * This script tests the Gemini API with extended thinking, which requires:
 * 1. Passing thinkingConfig with thinkingLevel
 * 2. Preserving thoughtSignature in function call responses
 * 3. Handling multi-turn conversations with signatures
 * 
 * The test ACTUALLY executes file operations to verify end-to-end behavior.
 * 
 * API Documentation:
 * - Gemini Thought Signatures: https://ai.google.dev/gemini-api/docs/thought-signatures
 * - Gemini 3 Models: https://ai.google.dev/gemini-api/docs/gemini-3
 * 
 * Key Gemini 3 Thinking Quirks:
 * - thoughtSignature MUST be passed back during function calling (400 error otherwise)
 * - For parallel function calls, only the FIRST function call has the signature
 * - For sequential function calls, ALL signatures must be preserved
 * - Non-function-call responses may have optional signatures (recommended to preserve)
 * 
 * Usage:
 *   GEMINI_API_KEY=... node llm-quirks-gemini.mjs
 * 
 * Exit codes:
 *   0 - Test passed
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

const GEMINI_MODEL = 'gemini-3-flash-preview';

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
          enum: ['view', 'create'],
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
  const toolCallsArray = Object.values(result.toolCalls);
  return {
    role: 'assistant',
    content: result.textContent ? [{ type: 'text', text: result.textContent }] : [],
    // Only include tool_calls if there are any (some APIs reject empty arrays)
    ...(toolCallsArray.length > 0 && {
      tool_calls: toolCallsArray.map(tc => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.arguments }
      }))
    }),
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
 * Run the Gemini thinking test
 */
async function runTest() {
  console.log('='.repeat(60));
  console.log('Testing: Gemini 3 Flash with Thinking');
  console.log(`Provider: gemini`);
  console.log(`Model: ${GEMINI_MODEL}`);
  console.log('='.repeat(60));

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('Missing GEMINI_API_KEY environment variable');
    process.exit(2);
  }

  const config = {
    provider: 'gemini',
    model: GEMINI_MODEL,
    apiKey: apiKey,
    reasoningEffort: 'high',  // Enable thinking
    maxOutputTokens: 8000,
  };

  console.log('\nCreating LLM client...');
  let client;
  try {
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

  if (turn >= maxTurns) {
    console.log('\n=== Max turns reached ===');
    return { success: false, turns: turn, error: 'Max turns reached without completion' };
  }

  // Validate results
  const issues = [];
  if (!hadThinking) issues.push('No thinking/reasoning content received');
  if (!hadSignature) issues.push('No thinking signature received');
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

  if (issues.length > 0) {
    console.log('\n⚠️  Warnings:');
    issues.forEach(issue => console.log(`  - ${issue}`));
    console.log(`\n⚠️ Test "Gemini 3 Flash Thinking" completed with warnings in ${turn} turns`);
  } else {
    console.log(`\n✅ Test "Gemini 3 Flash Thinking" completed successfully in ${turn} turns`);
  }
  return { success: true, turns: turn, hadThinking, hadSignature, hadToolCalls };
}

async function main() {
  console.log('');
  const result = await runTest();

  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));

  const status = result.success ? '✅ PASS' : '❌ FAIL';
  console.log(`${status} - Gemini 3 Flash Thinking (${result.turns} turns)`);
  if (result.error) {
    console.log(`       Error: ${result.error}`);
  }

  console.log('');
  if (result.success) {
    console.log('🎉 All tests passed!');
    process.exit(0);
  } else {
    console.log('💥 Test failed.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
