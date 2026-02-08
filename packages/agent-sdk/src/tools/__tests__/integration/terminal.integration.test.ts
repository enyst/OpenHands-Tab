import { describe, expect, it } from 'vitest';
import { TerminalTool } from '../../TerminalTool';
import { makeIntegrationWorkspace } from './helpers';

const isWindows = process.platform === 'win32';

describe('TerminalTool integration', () => {
  it.skipIf(isWindows)('returns stdout/stderr/exit_code payloads for real commands', async () => {
    const { workspace } = await makeIntegrationWorkspace();
    const tool = new TerminalTool();

    const result = await tool.execute(
      tool.validate({
        command: 'node -e "process.stdout.write(\'hello\'); process.stderr.write(\'oops\')"',
        timeout: 0.4,
      }),
      { workspace },
    );

    expect(result.exit_code).toBe(0);
    expect(result.timeout).toBe(false);
    expect(result.stdout ?? '').toContain('hello');
    expect(result.stderr ?? '').toContain('oops');

    const failed = await tool.execute(
      tool.validate({ command: 'node -e "process.exit(5)"', timeout: 0.4 }),
      { workspace },
    );

    expect(failed.exit_code).toBe(5);
    expect(failed.timeout).toBe(false);
    expect(failed.stdout).toBeDefined();
    expect(failed.stderr).toBeDefined();

    await tool.execute(tool.validate({ command: '', reset: true }), { workspace });
  });
});
