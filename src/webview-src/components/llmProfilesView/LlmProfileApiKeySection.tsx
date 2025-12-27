import type { RefObject } from 'react';
import type { ProfileFormMode } from './formState';
import { FieldLabel, InputField } from './fields';

export type LlmProfileApiKeySectionProps = {
  mode: ProfileFormMode;
  providerLabel: string | null;
  providerApiKeyUrl: string | null;
  providerRequiresApiKey: boolean;
  openMarkdownLink: (href: string) => void;
  showProviderKeyConfiguredIndicator: boolean;
  apiKeyStatusLabel: string;
  overrideProfileApiKey: boolean;
  onToggleOverrideProfileApiKey: (next: boolean) => void;
  canEditApiKey: boolean;
  apiKeySaving: boolean;
  showMissingApiKeyWarning: boolean;
  apiKeyInputRef: RefObject<HTMLInputElement | null>;
  apiKeyInput: string;
  setApiKeyInput: (value: string) => void;
  apiKeyStatusError: string | null;
  apiKeyError: string | null;
  showProfileApiKeyOverrideSetIndicator: boolean;
  onSaveApiKey: () => Promise<void> | void;
};

export function LlmProfileApiKeySection(props: LlmProfileApiKeySectionProps) {
  const {
    mode,
    providerLabel,
    providerApiKeyUrl,
    providerRequiresApiKey,
    openMarkdownLink,
    showProviderKeyConfiguredIndicator,
    apiKeyStatusLabel,
    overrideProfileApiKey,
    onToggleOverrideProfileApiKey,
    canEditApiKey,
    apiKeySaving,
    showMissingApiKeyWarning,
    apiKeyInputRef,
    apiKeyInput,
    setApiKeyInput,
    apiKeyStatusError,
    apiKeyError,
    showProfileApiKeyOverrideSetIndicator,
    onSaveApiKey,
  } = props;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-stone-200">
            {providerLabel ? `${providerLabel} API key` : 'API key'}
          </div>
          <div className="text-xs text-stone-500 mt-0.5">
            API keys are stored securely in VS Code Secret Storage. Not saved to disk.
          </div>
          {providerLabel && providerApiKeyUrl && (
            <button
              type="button"
              onClick={() => openMarkdownLink(providerApiKeyUrl)}
              className="mt-1 text-xs text-brand-300 underline decoration-white/20 hover:decoration-white/40 hover:text-brand-200 transition-colors"
              aria-label={`Get ${providerLabel} API Key`}
              title={`Get ${providerLabel} API Key`}
            >
              Get {providerLabel} API Key <span className="codicon codicon-link-external text-[11px]" />
            </button>
          )}
        </div>

        {providerRequiresApiKey ? (
          <div className="flex flex-col items-end gap-2">
            <div className="text-xs text-stone-400">
              {showProviderKeyConfiguredIndicator ? (
                <span
                  className="codicon codicon-check text-green-400"
                  title="Provider key configured"
                  aria-label="Provider key configured"
                />
              ) : (
                apiKeyStatusLabel
              )}
            </div>
            <label className="flex items-center gap-2 text-xs text-stone-300 select-none">
              <input
                type="checkbox"
                checked={overrideProfileApiKey}
                onChange={(e) => { onToggleOverrideProfileApiKey(e.target.checked); }}
                disabled={apiKeySaving || (mode === 'edit' && !canEditApiKey)}
                className="h-4 w-4 rounded border border-white/[0.2] bg-white/[0.02] text-brand-500 focus:ring-2 focus:ring-brand-500/40 focus:ring-offset-0 disabled:opacity-50"
              />
              Override for this profile
            </label>
          </div>
        ) : (
          <div className="text-xs text-stone-500">Select a provider to configure keys.</div>
        )}
      </div>

      {showMissingApiKeyWarning && (
        <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          You must provide a valid API key.
        </div>
      )}

      {mode === 'create' && providerRequiresApiKey && overrideProfileApiKey && (
        <div className="mt-3">
          <FieldLabel label="API key override" required htmlFor="llmProfilesApiKeyCreate" />
          <div className="mt-2">
            <InputField
              ref={apiKeyInputRef}
              id="llmProfilesApiKeyCreate"
              value={apiKeyInput}
              onChange={setApiKeyInput}
              placeholder="(hidden)"
              type="password"
            />
          </div>
        </div>
      )}

      {canEditApiKey && apiKeyStatusError && (
        <div className="mt-2 text-xs text-red-400">{apiKeyStatusError}</div>
      )}
      {canEditApiKey && apiKeyError && (
        <div className="mt-2 text-xs text-red-400">{apiKeyError}</div>
      )}

      {mode === 'edit' && canEditApiKey && providerRequiresApiKey && overrideProfileApiKey && (
        <div className="mt-3">
          <div className="flex items-center gap-2">
            <FieldLabel label="API key override" required htmlFor="llmProfilesApiKeyEdit" />
            {showProfileApiKeyOverrideSetIndicator && (
              <span
                className="codicon codicon-check text-emerald-400 text-sm"
                aria-label="API key override set"
                title="API key override set"
              />
            )}
          </div>
          <div className="mt-2">
            <InputField
              ref={apiKeyInputRef}
              id="llmProfilesApiKeyEdit"
              value={apiKeyInput}
              onChange={setApiKeyInput}
              placeholder="(hidden)"
              type="password"
            />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => { void onSaveApiKey(); }}
              disabled={apiKeySaving}
              aria-label="Save API key"
              className={`
                inline-flex items-center gap-2 px-4 py-2 rounded-lg
                text-sm font-medium
                transition-all
                border
                focus:outline-none focus:ring-0
                focus-visible:shadow-[0_0_0_1px_rgba(232,166,66,0.16)]
                ${apiKeySaving
                  ? 'bg-white/[0.03] text-stone-500 border-white/[0.06] cursor-not-allowed'
                  : 'bg-gradient-to-b from-brand-500/25 to-brand-600/20 text-brand-200 border-brand-500/30 hover:from-brand-500/35 hover:to-brand-600/30 hover:border-brand-500/40'}
              `}
            >
              <span className={`codicon codicon-${apiKeySaving ? 'loading' : 'save'} ${apiKeySaving ? 'animate-spin' : ''}`} />
              {apiKeySaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
