import type { ToolCall } from '../types';
import { toOptionalNonEmptyString } from './settingsUtils';

export function formatToolMessageText(toolCall: ToolCall, result: unknown): string {
  const toolName = toolCall.function.name;
  const asRecord = (value: unknown): Record<string, unknown> | undefined =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

  if (toolName === 'terminal') {
    const record = asRecord(result) ?? {};
    const commandFromArgs = (() => {
      const rawArgs = toOptionalNonEmptyString(toolCall.function.arguments);
      if (!rawArgs) return undefined;
      try {
        const parsed = JSON.parse(rawArgs) as Record<string, unknown>;
        return toOptionalNonEmptyString(parsed.command) ?? rawArgs;
      } catch {
        return rawArgs;
      }
    })();
    const command = toOptionalNonEmptyString(record.command) ?? commandFromArgs;
    const stdout = typeof record.stdout === 'string' ? record.stdout.trimEnd() : '';
    const stderr = typeof record.stderr === 'string' ? record.stderr.trimEnd() : '';
    const exitCode = typeof record.exit_code === 'number' ? record.exit_code : undefined;
    const timedOut = record.timeout === true;

    const parts: string[] = [];
    if (command) {
      parts.push(command.startsWith('$') ? command : `$ ${command}`);
    }
    const output = stdout && stderr ? `${stdout}\n${stderr}` : stdout || stderr;
    if (output) parts.push(output);
    if (typeof exitCode === 'number') {
      parts.push(`[Command finished with exit code ${exitCode}]`);
    } else {
      parts.push('[Command finished]');
    }
    if (timedOut) parts.push('[Command timed out]');
    return parts.join('\n');
  }

  if (toolName === 'file_editor') {
    const record = asRecord(result) ?? {};
    const command = toOptionalNonEmptyString(record.command);
    const targetPath = toOptionalNonEmptyString(record.path);
    const headerParts = ['file_editor'];
    if (command) headerParts.push(command);
    if (targetPath) headerParts.push(targetPath);
    const header = headerParts.join(' ');
    const content = typeof record.new_content === 'string' ? record.new_content : record.new_content === null ? '<file removed>' : '';
    return content ? `${header}\n${content}` : header;
  }

  if (typeof result === 'string') return result;
  if (result === null || result === undefined) return String(result);
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return Object.prototype.toString.call(result);
  }
}

