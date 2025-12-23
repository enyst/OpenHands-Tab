import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { TerminalTool } from '../TerminalTool';
import { LocalWorkspace } from '../../workspace/LocalWorkspace';
import { SecretRegistry } from '../../sdk/runtime/SecretRegistry';

const makeWorkspace = async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'terminal-tool-session-'));
  return { dir, workspace: new LocalWorkspace(dir) };
};

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.map((dir) => fs.promises.rm(dir, { recursive: true, force: true })));
  created.length = 0;
});

describe('TerminalTool session behavior', () => {
  it('injects registered secrets into the command environment when referenced', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new TerminalTool();
    const secrets = new SecretRegistry();
    secrets.register('GITHUB_TOKEN', 'ghp_example123');

    const result = await tool.execute(
      tool.validate({ command: 'node -e "process.stdout.write(process.env.GITHUB_TOKEN||\'\')"', timeout: 0.2 }),
      { workspace, secrets },
    );

    expect(result.exit_code).toBe(0);
    expect((result.stdout ?? '').trim()).toBe('ghp_example123');

    await tool.execute(tool.validate({ command: '', reset: true }), { workspace, secrets });
  });

  it('persists working directory across commands', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new TerminalTool();

    const first = await tool.execute(tool.validate({ command: 'pwd', timeout: 0.2 }), { workspace });
    expect(first.exit_code).toBe(0);
    expect((first.stdout ?? '').trim()).toBe(workspace.root);

    await tool.execute(tool.validate({ command: 'mkdir -p subdir && cd subdir', timeout: 0.2 }), { workspace });
    const second = await tool.execute(tool.validate({ command: 'pwd', timeout: 0.2 }), { workspace });
    expect(second.exit_code).toBe(0);
    expect((second.stdout ?? '').trim()).toBe(path.join(workspace.root, 'subdir'));

    await tool.execute(tool.validate({ command: '', reset: true }), { workspace });
  });

  it('supports is_input for interactive commands', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new TerminalTool();

    const start = await tool.execute(
      tool.validate({
        command: 'echo "Enter name:"; read name; echo "Hello $name"',
        timeout: 0.1,
      }),
      { workspace },
    );
    expect(start.exit_code).toBe(-1);
    const combinedStart = `${start.stdout ?? ''}${start.stderr ?? ''}`;
    expect(combinedStart).toContain('Enter name:');

    const reply = await tool.execute(
      tool.validate({
        command: 'John',
        is_input: true,
        timeout: 0.2,
      }),
      { workspace },
    );
    expect(reply.exit_code).toBe(0);
    expect(`${reply.stdout ?? ''}${reply.stderr ?? ''}`).toContain('Hello John');

    await tool.execute(tool.validate({ command: '', reset: true }), { workspace });
  });

  it('reset clears session state', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new TerminalTool();

    await tool.execute(tool.validate({ command: 'export OH_TAB_TEST_VAR=bar', timeout: 0.2 }), { workspace });
    const before = await tool.execute(tool.validate({ command: 'echo $OH_TAB_TEST_VAR', timeout: 0.2 }), { workspace });
    expect((before.stdout ?? '').trim()).toBe('bar');

    const reset = await tool.execute(tool.validate({ command: '', reset: true }), { workspace });
    expect(reset.exit_code).toBe(0);

    const after = await tool.execute(tool.validate({ command: 'echo $OH_TAB_TEST_VAR', timeout: 0.2 }), { workspace });
    expect((after.stdout ?? '').trim()).toBe('');

    await tool.execute(tool.validate({ command: '', reset: true }), { workspace });
  });

  it('C-c interrupts a long-running command and allows subsequent commands', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new TerminalTool();

    const started = await tool.execute(tool.validate({ command: 'sleep 2', timeout: 0.1 }), { workspace });
    expect(started.exit_code).toBe(-1);

    let interrupted = await tool.execute(tool.validate({ command: 'C-c', is_input: true, timeout: 0.2 }), { workspace });
    for (let i = 0; i < 5 && interrupted.exit_code === -1; i++) {
      interrupted = await tool.execute(tool.validate({ command: '', is_input: true, timeout: 0.2 }), { workspace });
    }
    expect(interrupted.exit_code).not.toBe(-1);

    const next = await tool.execute(tool.validate({ command: 'echo ok', timeout: 0.2 }), { workspace });
    expect(next.exit_code).toBe(0);
    expect((next.stdout ?? '').trim()).toBe('ok');

    await tool.execute(tool.validate({ command: '', reset: true }), { workspace });
  });

  it('rejects a new command while another command is still running', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new TerminalTool();

    const started = await tool.execute(tool.validate({ command: 'sleep 2', timeout: 0.05 }), { workspace });
    expect(started.exit_code).toBe(-1);

    await expect(tool.execute(tool.validate({ command: 'echo nope', timeout: 0.05 }), { workspace })).rejects.toThrowError(
      /Cannot start a new terminal command/i,
    );

    await tool.execute(tool.validate({ command: 'C-c', is_input: true, timeout: 0.2 }), { workspace });
    await tool.execute(tool.validate({ command: '', reset: true }), { workspace });
  });

  it('returns the final exit code when a timed-out command completes later', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new TerminalTool();

    const started = await tool.execute(tool.validate({ command: 'sleep 0.2; echo done', timeout: 0.05 }), { workspace });
    expect(started.exit_code).toBe(-1);

    let polled = await tool.execute(tool.validate({ command: '', is_input: true, timeout: 0.4 }), { workspace });
    for (let i = 0; i < 10 && polled.exit_code === -1; i++) {
      polled = await tool.execute(tool.validate({ command: '', is_input: true, timeout: 0.2 }), { workspace });
    }

    expect(polled.exit_code).toBe(0);
    expect(`${polled.stdout ?? ''}${polled.stderr ?? ''}`).toContain('done');

    const next = await tool.execute(tool.validate({ command: 'echo ok', timeout: 0.2 }), { workspace });
    expect(next.exit_code).toBe(0);
    expect((next.stdout ?? '').trim()).toBe('ok');

    await tool.execute(tool.validate({ command: '', reset: true }), { workspace });
  });

  it('executes a new command even if the previous one completed between calls', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new TerminalTool();

    const started = await tool.execute(tool.validate({ command: 'sleep 0.15; echo first', timeout: 0.05 }), { workspace });
    expect(started.exit_code).toBe(-1);

    await new Promise<void>((resolve) => setTimeout(resolve, 250));

    const next = await tool.execute(tool.validate({ command: 'echo second', timeout: 0.2 }), { workspace });
    expect(next.exit_code).toBe(0);
    expect(`${next.stdout ?? ''}${next.stderr ?? ''}`).toContain('first');
    expect(`${next.stdout ?? ''}${next.stderr ?? ''}`).toContain('second');

    await tool.execute(tool.validate({ command: '', reset: true }), { workspace });
  });

  it('returns previous metadata when a timed-out command finishes before the next command', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new TerminalTool();

    const started = await tool.execute(
      tool.validate({ command: 'sleep 0.15; echo first; false', timeout: 0.05 }),
      { workspace },
    );
    expect(started.exit_code).toBe(-1);

    await new Promise<void>((resolve) => setTimeout(resolve, 250));

    const next = await tool.execute(tool.validate({ command: 'echo second', timeout: 0.2 }), { workspace });
    expect(next.exit_code).toBe(0);
    expect(`${next.stdout ?? ''}${next.stderr ?? ''}`).toContain('first');
    expect(`${next.stdout ?? ''}${next.stderr ?? ''}`).toContain('second');

    expect(next.previous).toBeDefined();
    expect(next.previous?.exit_code).toBe(1);
    expect(next.previous?.exitCode).toBe(1);
    expect(next.previous?.command).toContain('sleep 0.15');

    await tool.execute(tool.validate({ command: '', reset: true }), { workspace });
  });
});
