export type ErrorClassification = 'agent' | 'conversation';

export type ErrorContext = {
  stage: 'tool_args' | 'tool_lookup' | 'tool_validation' | 'tool_execute' | 'llm_init' | 'llm_request';
  toolName?: string;
  rawArgs?: string;
};

export type ClassifiedError = {
  classification: ErrorClassification;
  message: string;
  code?: string;
};

type ErrnoException = Error & { code?: string; syscall?: string; path?: string };

const normalizeMessage = (value: unknown): string => {
  const raw = value instanceof Error ? value.message : String(value);
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  return trimmed || 'Unknown error';
};

export const classifyConversationErrorCode = (message: string): string | undefined => {
  if (message.includes('Missing API key for LLM provider')) return 'missing_llm_api_key';
  if (message.includes('LLM model is not configured')) return 'llm_model_not_configured';
  if (message.startsWith('LLM request failed')) return 'llm_request_failed';
  return undefined;
};

const isErrnoException = (error: unknown): error is ErrnoException => {
  return Boolean(error && typeof error === 'object' && 'code' in error);
};

export class ClassifiedToolExecutionError extends Error {
  readonly classification: ErrorClassification;
  readonly code?: string;

  constructor(params: { classification: ErrorClassification; message: string; code?: string }) {
    super(params.message);
    this.name = 'ClassifiedToolExecutionError';
    this.classification = params.classification;
    this.code = params.code;
  }
}

export const classifyError = (error: unknown, context: ErrorContext): ClassifiedError => {
  const baseMessage = normalizeMessage(error);
  let message = baseMessage;

  if (context.stage === 'llm_init' || context.stage === 'llm_request') {
    return { classification: 'conversation', message, code: classifyConversationErrorCode(message) };
  }

  // Default tool behavior: treat as agent-visible so the LLM can self-correct.
  let classification: ErrorClassification = 'agent';
  let code: string | undefined;

  if ((context.stage === 'tool_args' || context.stage === 'tool_validation') && context.rawArgs && context.toolName) {
    message = `Error validating args ${context.rawArgs} for tool '${context.toolName}': ${baseMessage}`;
  }

  if (context.stage === 'tool_execute') {
    // Environment/infra failures that are not actionable by the LLM should halt the run.
    if (message.includes('Global fetch API is unavailable in this runtime')) {
      classification = 'conversation';
      code = 'missing_fetch_api';
    }

    // TerminalSession always spawns a shell (/bin/bash on unix, ComSpec/cmd.exe on windows). If that is missing,
    // treat it as environment-level (conversation) rather than agent-visible.
    if (classification === 'agent' && isErrnoException(error) && error.code === 'ENOENT') {
      const needle = (error.path ?? message).toLowerCase();
      if (needle.includes('/bin/bash') || needle.includes('cmd.exe')) {
        classification = 'conversation';
        code = 'terminal_shell_missing';
      }
    }
  }

  return { classification, message, ...(code ? { code } : {}) };
};
