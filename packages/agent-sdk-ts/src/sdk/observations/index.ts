import type { ToolCall } from '../types';

export type Observation = TerminalObservation | FileEditorObservation | GenericObservation;

export interface TerminalObservation {
  kind: 'terminal';
  command?: string;
  stdout?: string;
  stderr?: string;
  exit_code?: number;
  timeout?: boolean;
}

export interface FileEditorObservation {
  kind: 'file_editor';
  command?: string;
  path?: string;
  new_content?: string | null;
}

export interface GenericObservation {
  kind: 'generic';
  value: unknown;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const toOptionalNonEmptyString = (value: unknown): string | undefined => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed : undefined;
};

const parseTerminalCommandFromToolCall = (toolCall: ToolCall): string | undefined => {
  const rawArgs = toOptionalNonEmptyString(toolCall.function.arguments);
  if (!rawArgs) return undefined;
  try {
    const parsed = JSON.parse(rawArgs) as Record<string, unknown>;
    return toOptionalNonEmptyString(parsed.command) ?? rawArgs;
  } catch {
    return rawArgs;
  }
};

export function toObservation(toolCall: ToolCall, result: unknown): Observation {
  const toolName = toolCall.function.name;

  if (toolName === 'terminal') {
    const record = asRecord(result) ?? {};
    const command = toOptionalNonEmptyString(record.command) ?? parseTerminalCommandFromToolCall(toolCall);
    const stdout = typeof record.stdout === 'string' ? record.stdout : undefined;
    const stderr = typeof record.stderr === 'string' ? record.stderr : undefined;
    const exit_code = typeof record.exit_code === 'number' ? record.exit_code : undefined;
    const timeout = record.timeout === true;
    return { kind: 'terminal', command, stdout, stderr, exit_code, timeout };
  }

  if (toolName === 'file_editor') {
    const record = asRecord(result) ?? {};
    const command = toOptionalNonEmptyString(record.command);
    const path = toOptionalNonEmptyString(record.path);
    const new_content =
      typeof record.new_content === 'string'
        ? record.new_content
        : record.new_content === null
          ? null
          : undefined;
    return { kind: 'file_editor', command, path, new_content };
  }

  return { kind: 'generic', value: result };
}

export function observationToLLMText(observation: Observation): string {
  if (observation.kind === 'terminal') {
    const stdout = typeof observation.stdout === 'string' ? observation.stdout.trimEnd() : '';
    const stderr = typeof observation.stderr === 'string' ? observation.stderr.trimEnd() : '';
    const output = stdout && stderr ? `${stdout}\n${stderr}` : stdout || stderr;

    const parts: string[] = [];
    if (observation.command) {
      parts.push(observation.command.startsWith('$') ? observation.command : `$ ${observation.command}`);
    }
    if (output) parts.push(output);
    if (typeof observation.exit_code === 'number') {
      parts.push(`[Command finished with exit code ${observation.exit_code}]`);
    } else {
      parts.push('[Command finished]');
    }
    if (observation.timeout) parts.push('[Command timed out]');
    return parts.join('\n');
  }

  if (observation.kind === 'file_editor') {
    const headerParts = ['file_editor'];
    if (observation.command) headerParts.push(observation.command);
    if (observation.path) headerParts.push(observation.path);
    const header = headerParts.join(' ');
    const content =
      typeof observation.new_content === 'string'
        ? observation.new_content
        : observation.new_content === null
          ? '<file removed>'
          : '';
    return content ? `${header}\n${content}` : header;
  }

  const result = observation.value;
  if (typeof result === 'string') return result;
  if (result === null || result === undefined) return String(result);
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return Object.prototype.toString.call(result);
  }
}

export function toolResultToLLMText(toolCall: ToolCall, result: unknown): string {
  return observationToLLMText(toObservation(toolCall, result));
}
