import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

import {
  createMockContext,
  getMockSettings,
  mockOpenHandsTerminalLog,
  resetHarnessState,
  resolveChatView,
  setMockSettings,
  setRegisteredSecretValues,
} from './extension.test.harness';

describe('Settings and modes', () => {
  let mockContext: any;
  let extension: any;

  beforeEach(() => {
    resetHarnessState();
    mockContext = createMockContext();
  });

  afterEach(() => {
    extension?.deactivate?.();
  });

  it('configure command opens VS Code settings', async () => {
    setMockSettings({ ...getMockSettings(), serverUrl: 'http://updated:3000' });
    extension = await import('../extension');
    await extension.activate(mockContext);

    await vscode.commands.executeCommand('openhands.configure');
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'workbench.action.openSettings',
      '@ext:openhands.openhands-tab'
    );
  });

  it('recreates the terminal after user closes it', async () => {
    setMockSettings({ ...getMockSettings(), serverUrl: undefined as any });
    extension = await import('../extension');
    await extension.activate(mockContext);
    await resolveChatView(mockContext);

    const { writes, terminals } = mockOpenHandsTerminalLog();

    const conv = (await import('@openhands/agent-sdk-ts')).__getLastConversation?.();

    conv?.emit('terminal', {
      id: 'bash-1',
      type: 'BashCommand',
      timestamp: '2025-01-01T00:00:00.000Z',
      command_id: 'tc-1',
      order: 0,
      command: 'first_command',
    });
    expect(vscode.window.createTerminal).toHaveBeenCalledTimes(1);

    const closeHandler = (vscode.window.onDidCloseTerminal as any).mock.calls[0]?.[0];
    closeHandler?.(terminals[0]);

    conv?.emit('terminal', {
      id: 'bash-2',
      type: 'BashCommand',
      timestamp: '2025-01-01T00:00:01.000Z',
      command_id: 'tc-2',
      order: 0,
      command: 'second_command',
    });

    expect(vscode.window.createTerminal).toHaveBeenCalledTimes(2);
    const joined = writes.join('');
    expect(joined).toContain('$ first_command');
    expect(joined).toContain('$ second_command');
  });

  it('handles ANSI sequences and emoji across chunk boundary', async () => {
    setMockSettings({ ...getMockSettings(), serverUrl: undefined as any });
    extension = await import('../extension');
    await extension.activate(mockContext);
    await resolveChatView(mockContext);

    const { writes } = mockOpenHandsTerminalLog();

    const conv = (await import('@openhands/agent-sdk-ts')).__getLastConversation?.();

    const coloredOutput = '\x1b[31m' + 'red'.repeat(5500) + '\x1b[0m' + '🚀'.repeat(100);

    conv?.emit('terminal', {
      id: 'bash-9',
      type: 'BashCommand',
      timestamp: '2025-01-01T00:00:08.000Z',
      command_id: 'tc-5',
      order: 0,
      command: 'echo_colored_emoji',
    });
    conv?.emit('terminal', {
      id: 'bash-10',
      type: 'BashOutput',
      timestamp: '2025-01-01T00:00:09.000Z',
      command_id: 'tc-5',
      order: 1,
      exit_code: 0,
      stdout: coloredOutput,
      stderr: null,
    });

    const joined = writes.join('');
    expect(joined).toContain('$ echo_colored_emoji\r\n');
    expect(joined).toContain(coloredOutput);
    expect(joined).toContain('\x1b[31m');
    expect(joined).toContain('\x1b[0m');
  });

  it('creates a local-mode conversation when serverUrl is empty', async () => {
    setMockSettings({ ...getMockSettings(), serverUrl: undefined as any });
    extension = await import('../extension');
    await extension.activate(mockContext);
    await resolveChatView(mockContext);

    const sdk = await import('@openhands/agent-sdk-ts');
    const conv = sdk.__getLastConversation?.();
    expect(conv?.mode).toBe('local');

    const agentContextParams = sdk.__getLastAgentContextParams?.();
    expect(agentContextParams).toBeTruthy();
    expect(agentContextParams?.loadUserSkills).toBe(true);
    expect(sdk.loadSkillsFromDir).toHaveBeenCalledWith(path.join('/test/workspace', '.openhands', 'skills'));
  });

  it('streams BashEvents into the OpenHands terminal log in local mode', async () => {
    setMockSettings({ ...getMockSettings(), serverUrl: undefined as any });
    extension = await import('../extension');
    await extension.activate(mockContext);
    await resolveChatView(mockContext);

    const { writes } = mockOpenHandsTerminalLog();

    const conv = (await import('@openhands/agent-sdk-ts')).__getLastConversation?.();

    // Test 1: Basic command and stdout
    conv?.emit('terminal', {
      id: 'bash-1',
      type: 'BashCommand',
      timestamp: '2025-01-01T00:00:00.000Z',
      command_id: 'tc-1',
      order: 0,
      command: 'pwd && ls -la',
    });
    conv?.emit('terminal', {
      id: 'bash-2',
      type: 'BashOutput',
      timestamp: '2025-01-01T00:00:01.000Z',
      command_id: 'tc-1',
      order: 1,
      exit_code: 0,
      stdout: '/test/workspace\n',
      stderr: null,
    });

    // Test 2: Stderr output
    conv?.emit('terminal', {
      id: 'bash-3',
      type: 'BashCommand',
      timestamp: '2025-01-01T00:00:02.000Z',
      command_id: 'tc-2',
      order: 0,
      command: 'command_with_error',
    });
    conv?.emit('terminal', {
      id: 'bash-4',
      type: 'BashOutput',
      timestamp: '2025-01-01T00:00:03.000Z',
      command_id: 'tc-2',
      order: 1,
      exit_code: 1,
      stdout: null,
      stderr: 'Error: command not found\n',
    });

    // Test 3: Newline normalization (mixed \n and \r\n)
    conv?.emit('terminal', {
      id: 'bash-5',
      type: 'BashCommand',
      timestamp: '2025-01-01T00:00:04.000Z',
      command_id: 'tc-3',
      order: 0,
      command: 'echo "hello\r\nworld\n"',
    });
    conv?.emit('terminal', {
      id: 'bash-6',
      type: 'BashOutput',
      timestamp: '2025-01-01T00:00:05.000Z',
      command_id: 'tc-3',
      order: 1,
      exit_code: 0,
      stdout: 'hello\r\nworld\n',
      stderr: null,
    });

    // Test 4: Output chunking (very large string)
    const largeOutput = 'a'.repeat(20_000);
    conv?.emit('terminal', {
      id: 'bash-7',
      type: 'BashCommand',
      timestamp: '2025-01-01T00:00:06.000Z',
      command_id: 'tc-4',
      order: 0,
      command: 'echo_large_output',
    });
    conv?.emit('terminal', {
      id: 'bash-8',
      type: 'BashOutput',
      timestamp: '2025-01-01T00:00:07.000Z',
      command_id: 'tc-4',
      order: 1,
      exit_code: 0,
      stdout: largeOutput,
      stderr: null,
    });

    expect(vscode.window.createTerminal).toHaveBeenCalledWith(expect.objectContaining({ name: 'OpenHands' }));
    expect(writes.join('')).toContain('$ pwd && ls -la\r\n');
    expect(writes.join('')).toContain('/test/workspace\r\n');
    expect(writes.join('')).toContain('$ command_with_error\r\n');
    expect(writes.join('')).toContain('Error: command not found\r\n');
    expect(writes.join('')).toContain('$ echo "hello\r\nworld\r\n"\r\n');
    expect(writes.join('')).toContain('hello\r\nworld\r\n');
    expect(writes.join('')).toContain('$ echo_large_output\r\n');
    expect(writes.join('')).toContain(largeOutput);
  });

  it('streams stdout and stderr from a single BashOutput event into the OpenHands terminal log', async () => {
    setMockSettings({ ...getMockSettings(), serverUrl: undefined as any });
    extension = await import('../extension');
    await extension.activate(mockContext);
    await resolveChatView(mockContext);

    const { writes } = mockOpenHandsTerminalLog();

    const conv = (await import('@openhands/agent-sdk-ts')).__getLastConversation?.();

    conv?.emit('terminal', {
      id: 'bash-mixed-1',
      type: 'BashCommand',
      timestamp: '2025-01-01T00:00:00.000Z',
      command_id: 'tc-mixed-1',
      order: 0,
      command: 'mixed_output',
    });
    conv?.emit('terminal', {
      id: 'bash-mixed-2',
      type: 'BashOutput',
      timestamp: '2025-01-01T00:00:01.000Z',
      command_id: 'tc-mixed-1',
      order: 1,
      exit_code: 0,
      stdout: 'stdout line\n',
      stderr: 'stderr line\n',
    });

    const joined = writes.join('');
    expect(joined).toContain('$ mixed_output\r\n');
    expect(joined).toContain('stdout line\r\n');
    expect(joined).toContain('stderr line\r\n');
  });

  it('masks secrets in terminal output before writing to the log', async () => {
    setRegisteredSecretValues(['supersecret']);
    setMockSettings({ ...getMockSettings(), serverUrl: undefined as any });
    extension = await import('../extension');
    await extension.activate(mockContext);
    await resolveChatView(mockContext);

    const { writes } = mockOpenHandsTerminalLog();

    const conv = (await import('@openhands/agent-sdk-ts')).__getLastConversation?.();

    conv?.emit('terminal', {
      id: 'bash-secret-1',
      type: 'BashCommand',
      timestamp: '2025-01-01T00:00:00.000Z',
      command_id: 'tc-secret-1',
      order: 0,
      command: 'echo supersecret',
    });
    conv?.emit('terminal', {
      id: 'bash-secret-2',
      type: 'BashOutput',
      timestamp: '2025-01-01T00:00:01.000Z',
      command_id: 'tc-secret-1',
      order: 1,
      exit_code: 0,
      stdout: 'token=supersecret\n',
      stderr: null,
    });

    const joined = writes.join('');
    expect(joined).toContain('$ echo [REDACTED]\r\n');
    expect(joined).toContain('token=[REDACTED]\r\n');
    expect(joined).not.toContain('supersecret');
  });

  it('coalesces CR-only progress output in the OpenHands terminal log', async () => {
    setMockSettings({ ...getMockSettings(), serverUrl: undefined as any });
    extension = await import('../extension');
    await extension.activate(mockContext);
    await resolveChatView(mockContext);

    const { writes, getLastPty } = mockOpenHandsTerminalLog({ capturePty: true });

    const conv = (await import('@openhands/agent-sdk-ts')).__getLastConversation?.();

    conv?.emit('terminal', {
      id: 'bash-progress-1',
      type: 'BashCommand',
      timestamp: '2025-01-01T00:00:00.000Z',
      command_id: 'tc-progress-1',
      order: 0,
      command: 'progress_output',
    });

    const ptyInstance = getLastPty();
    expect(ptyInstance).toBeTruthy();

    // Simulate progress updates arriving in multiple chunks (including CSI K split across writes).
    ptyInstance.write('Downloading 1%');
    ptyInstance.write('\rDownloading 2%');
    ptyInstance.write('\rDownloading 3%');
    ptyInstance.write('\n');

    ptyInstance.write('Longer line that should be cleared');
    ptyInstance.write('\rShort');
    ptyInstance.write('\u001b');
    ptyInstance.write('[K\n');

    const joined = writes.join('');
    expect(joined).toContain('$ progress_output\r\n');
    expect(joined).toContain('Downloading 3%\r\n');
    expect(joined).not.toContain('Downloading 1%');
    expect(joined).not.toContain('Downloading 2%');
    expect(joined).toContain('Short\r\n');
    expect(joined).not.toContain('Longer line that should be cleared');
    expect(joined).not.toContain('\u001b[K');
  });

  it('warns once and flushes when the progress coalescing buffer overflows', async () => {
    setMockSettings({ ...getMockSettings(), serverUrl: undefined as any });
    extension = await import('../extension');
    await extension.activate(mockContext);
    await resolveChatView(mockContext);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { writes, getLastPty } = mockOpenHandsTerminalLog({ capturePty: true });

    const conv = (await import('@openhands/agent-sdk-ts')).__getLastConversation?.();

    conv?.emit('terminal', {
      id: 'bash-progress-overflow-1',
      type: 'BashCommand',
      timestamp: '2025-01-01T00:00:00.000Z',
      command_id: 'tc-progress-overflow-1',
      order: 0,
      command: 'progress_overflow',
    });

    const ptyInstance = getLastPty();
    expect(ptyInstance).toBeTruthy();

    const huge = 'a'.repeat(200_001);
    ptyInstance.write(huge);
    ptyInstance.write('\n');
    ptyInstance.write('b'.repeat(200_001));
    ptyInstance.write('\n');

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Terminal progress renderer overflowed')
    );

    warn.mockRestore();
    expect(writes.join('')).toContain('$ progress_overflow\r\n');
  });

  it('coalesces ANSI-colored progress output (including split CSI sequences)', async () => {
    setMockSettings({ ...getMockSettings(), serverUrl: undefined as any });
    extension = await import('../extension');
    await extension.activate(mockContext);
    await resolveChatView(mockContext);

    const { writes, getLastPty } = mockOpenHandsTerminalLog({ capturePty: true });

    const conv = (await import('@openhands/agent-sdk-ts')).__getLastConversation?.();

    conv?.emit('terminal', {
      id: 'bash-progress-color-1',
      type: 'BashCommand',
      timestamp: '2025-01-01T00:00:00.000Z',
      command_id: 'tc-progress-color-1',
      order: 0,
      command: 'progress_colored',
    });

    const ptyInstance = getLastPty();
    expect(ptyInstance).toBeTruthy();

    ptyInstance.write('\u001b[32mDownloading 1%\u001b[0m');
    ptyInstance.write('\r\u001b[33mDownloading 2%\u001b[0m');
    // Split escape sequence across writes.
    ptyInstance.write('\r\u001b');
    ptyInstance.write('[34mDownloading 3%\u001b[0m');
    ptyInstance.write('\n');

    const joined = writes.join('');
    expect(joined).toContain('$ progress_colored\r\n');
    expect(joined).toContain('\u001b[34mDownloading 3%\u001b[0m\r\n');
    expect(joined).not.toContain('Downloading 1%');
    expect(joined).not.toContain('Downloading 2%');
  });

  it('strips terminal string control sequences (OSC/DCS) from the OpenHands terminal log', async () => {
    setMockSettings({ ...getMockSettings(), serverUrl: undefined as any });
    extension = await import('../extension');
    await extension.activate(mockContext);
    await resolveChatView(mockContext);

    const { writes, getLastPty } = mockOpenHandsTerminalLog({ capturePty: true });

    const conv = (await import('@openhands/agent-sdk-ts')).__getLastConversation?.();

    conv?.emit('terminal', {
      id: 'bash-sanitize-1',
      type: 'BashCommand',
      timestamp: '2025-01-01T00:00:00.000Z',
      command_id: 'tc-sanitize-1',
      order: 0,
      command: 'sanitize_output',
    });

    const ptyInstance = getLastPty();
    expect(ptyInstance).toBeTruthy();

    // OSC with BEL terminator
    ptyInstance.write('hello\u001b]0;title\u0007world\n');
    // OSC with ST (ESC \\) terminator
    ptyInstance.write('a\u001b]8;;https://example.com\u001b\\b\n');
    // DCS with ST terminator
    ptyInstance.write('x\u001bPqstuff\u001b\\y\n');

    const joined = writes.join('');
    expect(joined).toContain('$ sanitize_output\r\n');
    expect(joined).toContain('helloworld\r\n');
    expect(joined).toContain('ab\r\n');
    expect(joined).toContain('xy\r\n');
    expect(joined).not.toContain('\u001b]');
    expect(joined).not.toContain('\u001bP');
  });
});
