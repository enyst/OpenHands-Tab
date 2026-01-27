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
    expect((result.stdout ?? '').trim()).toBe('<secret-hidden>');
    expect(result.stdout ?? '').not.toContain('ghp_example123');

    await tool.execute(tool.validate({ command: '', reset: true }), { workspace, secrets });
  });

  it('avoids injecting secrets when the command does not reference the name', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const secrets = new SecretRegistry();
    const secretName = 'OH_TAB_TEST_SECRET';

    const previous = process.env[secretName];
    delete process.env[secretName];

    try {
      const tool = new TerminalTool();
      secrets.register(secretName, 'super-secret');

      const result = await tool.execute(
        tool.validate({ command: 'node -e "process.stdout.write(Object.keys(process.env).join(\',\'))"', timeout: 0.2 }),
        { workspace, secrets },
      );

      expect(result.exit_code).toBe(0);
      expect(result.stdout ?? '').not.toContain(secretName);

      await tool.execute(tool.validate({ command: '', reset: true }), { workspace, secrets });
    } finally {
      if (previous === undefined) {
        delete process.env[secretName];
      } else {
        process.env[secretName] = previous;
      }
    }
  });

  it('does not inject secrets for partial name matches', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const secrets = new SecretRegistry();
    const secretName = 'OH_TAB_TEST_SECRET';

    const previous = process.env[secretName];
    delete process.env[secretName];

    try {
      const tool = new TerminalTool();
      secrets.register(secretName, 'super-secret');

      const trigger = await tool.execute(
        tool.validate({ command: 'node -e "process.stdout.write(\'OH_TAB_TEST_SECRET_EXTRA\')"', timeout: 0.2 }),
        { workspace, secrets },
      );
      expect(trigger.exit_code).toBe(0);

      const check = await tool.execute(
        tool.validate({ command: 'node -e "process.stdout.write(Object.keys(process.env).join(\',\'))"', timeout: 0.2 }),
        { workspace, secrets },
      );
      expect(check.exit_code).toBe(0);
      expect(check.stdout ?? '').not.toContain(secretName);

      await tool.execute(tool.validate({ command: '', reset: true }), { workspace, secrets });
    } finally {
      if (previous === undefined) {
        delete process.env[secretName];
      } else {
        process.env[secretName] = previous;
      }
    }
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

    const blocked = await tool.execute(tool.validate({ command: 'echo nope', timeout: 0.05 }), { workspace });
    expect(blocked.exit_code).toBe(-1);
    expect(`${blocked.stdout ?? ''}${blocked.stderr ?? ''}`).toMatch(/NOT executed/i);
    expect(blocked.command).toBe('echo nope');
    expect(`${blocked.stdout ?? ''}${blocked.stderr ?? ''}`).toContain('sleep 2');

    await tool.execute(tool.validate({ command: 'C-c', is_input: true, timeout: 0.2 }), { workspace });
    await tool.execute(tool.validate({ command: '', reset: true }), { workspace });
  });

  it('allows a new command after a background command returns immediately', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new TerminalTool();

    let completed = await tool.execute(
      tool.validate({ command: 'sleep 0.4 > /dev/null 2>&1 &', timeout: 0.2 }),
      { workspace },
    );
    for (let i = 0; i < 5 && completed.exit_code === -1; i++) {
      completed = await tool.execute(tool.validate({ command: '', is_input: true, timeout: 0.2 }), { workspace });
    }
    expect(completed.exit_code).toBe(0);

    const next = await tool.execute(tool.validate({ command: 'echo ok', timeout: 0.2 }), { workspace });
    expect(next.exit_code).toBe(0);
    expect((next.stdout ?? '').trim()).toBe('ok');

    await tool.execute(tool.validate({ command: '', reset: true }), { workspace });
  });

  it('runs a foreground command while a background job is still running', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new TerminalTool();
    let backgroundPid: number | null = null;

    try {
      let started = await tool.execute(
        tool.validate({ command: 'sleep 2 & echo $!', timeout: 0.2 }),
        { workspace },
      );
      for (let i = 0; i < 5 && started.exit_code === -1; i++) {
        started = await tool.execute(tool.validate({ command: '', is_input: true, timeout: 0.2 }), { workspace });
      }

      expect(started.exit_code).toBe(0);
      expect((started.stderr ?? '').trim()).toBe('');
      const pidText = (started.stdout ?? '').trim();
      expect(pidText).toMatch(/^\d+$/);
      backgroundPid = Number.parseInt(pidText, 10);
      expect(Number.isFinite(backgroundPid)).toBe(true);

      const second = await tool.execute(tool.validate({ command: 'echo second', timeout: 0.2 }), { workspace });
      expect(second.exit_code).toBe(0);
      expect((second.stdout ?? '').trim()).toBe('second');
      expect((second.stderr ?? '').trim()).toBe('');

      const running = await tool.execute(
        tool.validate({ command: `ps -p ${backgroundPid} -o pid=`, timeout: 0.2 }),
        { workspace },
      );
      expect(running.exit_code).toBe(0);
      expect((running.stdout ?? '').trim()).toBe(String(backgroundPid));

      await new Promise((resolve) => setTimeout(resolve, 2100));
      const finished = await tool.execute(
        tool.validate({ command: `ps -p ${backgroundPid} -o pid=`, timeout: 0.2 }),
        { workspace },
      );
      expect((finished.stdout ?? '').trim()).toBe('');
      expect(finished.exit_code).not.toBe(0);
    } finally {
      if (backgroundPid && Number.isFinite(backgroundPid)) {
        await tool.execute(
          tool.validate({ command: `kill ${backgroundPid} 2>/dev/null || true`, timeout: 0.2 }),
          { workspace },
        );
      }
      await tool.execute(tool.validate({ command: '', reset: true }), { workspace });
    }
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

    await new Promise<void>((resolve) => setTimeout(resolve, 400));

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

    await new Promise<void>((resolve) => setTimeout(resolve, 400));

    const next = await tool.execute(tool.validate({ command: 'echo second', timeout: 0.2 }), { workspace });
    expect(next.exit_code).toBe(0);
    expect(`${next.stdout ?? ''}${next.stderr ?? ''}`).toContain('first');
    expect(`${next.stdout ?? ''}${next.stderr ?? ''}`).toContain('second');

    expect(next.previous).toBeDefined();
    expect(next.previous?.exit_code).toBe(1);
    expect(next.previous?.command).toContain('sleep 0.15');

    await tool.execute(tool.validate({ command: '', reset: true }), { workspace });
  });
});
