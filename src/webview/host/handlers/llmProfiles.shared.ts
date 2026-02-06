import type * as vscode from 'vscode';
import { assertValidProfileId, LLMProfileValidationError } from '@openhands/agent-sdk-ts';
import type { CreateWebviewMessageHandlerDeps } from '../webviewMessageHandler.types';
import * as llmProfilesStore from '../llmProfilesStore';

export const validateProfileId = (profileId: string): void => {
  try {
    assertValidProfileId(profileId);
  } catch (err) {
    if (err instanceof LLMProfileValidationError) {
      throw new Error(err.message);
    }
    throw err;
  }
};

export const getProfileApiKeySecretKey = (profileId: string): string => {
  validateProfileId(profileId);
  return `openhands.llmProfileApiKey.${profileId}`;
};

export const llmProfileStoreOptions = (deps: CreateWebviewMessageHandlerDeps): { rootDir?: string } => {
  const rootDir = typeof deps.getLlmProfilesStoreRoot === 'function' ? deps.getLlmProfilesStoreRoot() : undefined;
  if (typeof rootDir !== 'string') return {};
  const trimmed = rootDir.trim();
  return trimmed ? { rootDir: trimmed } : {};
};

export const listAvailableLlmProfiles = (args: {
  deps: CreateWebviewMessageHandlerDeps;
  outputChannel: vscode.OutputChannel | undefined;
}): string[] => {
  try {
    return llmProfilesStore.listProfiles(llmProfileStoreOptions(args.deps));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    args.outputChannel?.appendLine(`[llm] Failed to list profiles: ${reason}`);
    return [];
  }
};
