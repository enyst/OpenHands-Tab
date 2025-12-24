import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LLMConfiguration } from '@openhands/agent-sdk-ts';
import { useCloseOnEscapeAndOutsideClick } from './useCloseOnEscapeAndOutsideClick';

type ProfileFormMode = 'create' | 'edit';

type ProfileFormState = {
  name: string;
  provider: '' | 'openai' | 'anthropic' | 'openrouter' | 'litellm_proxy' | 'gemini';
  model: string;
  baseUrl: string;
  apiVersion: string;
  openaiApiMode: 'auto' | 'chat_completions' | 'responses';
  timeoutSeconds: string;
  temperature: string;
  topP: string;
  topK: string;
  maxInputTokens: string;
  maxOutputTokens: string;
  reasoningEffort: '' | 'none' | 'low' | 'medium' | 'high';
  reasoningSummary: '' | 'auto' | 'concise' | 'detailed';
  inputCostPerToken: string;
  outputCostPerToken: string;
};

type FieldErrors = Partial<Record<keyof ProfileFormState, string>>;

type ApiKeyStatus =
  | { state: 'unknown' }
  | { state: 'loading' }
  | { state: 'ready'; hasKey: boolean }
  | { state: 'error'; error: string };

const EMPTY_FORM: ProfileFormState = {
  name: '',
  provider: '',
  model: '',
  baseUrl: '',
  apiVersion: '',
  openaiApiMode: 'auto',
  timeoutSeconds: '',
  temperature: '',
  topP: '',
  topK: '',
  maxInputTokens: '',
  maxOutputTokens: '',
  reasoningEffort: '',
  reasoningSummary: '',
  inputCostPerToken: '',
  outputCostPerToken: '',
};

const toFormState = (profileId: string, config: LLMConfiguration): ProfileFormState => {
  const strOrEmpty = (v: unknown): string => (typeof v === 'string' ? v : '');
  const numOrEmpty = (v: unknown): string => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
  const nullableStr = (v: unknown): string => (typeof v === 'string' ? v : '');
  const nullableNum = (v: unknown): string => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
  const provider = config.provider;
  const openaiApiMode = provider === 'openai' && config.openaiApiMode
    ? config.openaiApiMode
    : 'auto';

  return {
    ...EMPTY_FORM,
    name: profileId,
    provider: provider === 'openai' || provider === 'anthropic' || provider === 'openrouter' || provider === 'litellm_proxy' || provider === 'gemini'
      ? provider
      : '',
    model: strOrEmpty(config.model),
    baseUrl: nullableStr(config.baseUrl),
    apiVersion: nullableStr(config.apiVersion),
    openaiApiMode,
    timeoutSeconds: nullableNum(config.timeoutSeconds),
    temperature: nullableNum(config.temperature),
    topP: nullableNum(config.topP),
    topK: nullableNum(config.topK),
    maxInputTokens: nullableNum(config.maxInputTokens),
    maxOutputTokens: nullableNum(config.maxOutputTokens),
    reasoningEffort: config.reasoningEffort === null || config.reasoningEffort === undefined
      ? ''
      : (config.reasoningEffort === 'none' || config.reasoningEffort === 'low' || config.reasoningEffort === 'medium' || config.reasoningEffort === 'high')
        ? config.reasoningEffort
        : '',
    reasoningSummary: config.reasoningSummary === null || config.reasoningSummary === undefined
      ? ''
      : (config.reasoningSummary === 'auto' || config.reasoningSummary === 'concise' || config.reasoningSummary === 'detailed')
        ? config.reasoningSummary
        : '',
    inputCostPerToken: numOrEmpty(config.inputCostPerToken),
    outputCostPerToken: numOrEmpty(config.outputCostPerToken),
  };
};

const validateProfileId = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return 'Name is required';
  if (trimmed !== value) return 'Name must not have leading/trailing whitespace';
  if (trimmed.includes('/') || trimmed.includes('\\')) return 'Name must not contain path separators';
  if (/\s/.test(trimmed)) return 'Name must not contain spaces';
  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) return 'Name contains invalid characters';
  return null;
};

const parseOptionalNumber = (raw: string): { value: number | null; error?: string } => {
  const trimmed = raw.trim();
  if (!trimmed) return { value: null };
  const num = Number(trimmed);
  if (!Number.isFinite(num)) return { value: null, error: 'Must be a valid number' };
  if (num < 0) return { value: null, error: 'Must be >= 0' };
  return { value: num };
};

const parseOptionalInt = (raw: string): { value: number | null; error?: string } => {
  const base = parseOptionalNumber(raw);
  if (base.error || base.value === null) return base;
  if (!Number.isInteger(base.value)) return { value: null, error: 'Must be an integer' };
  return base;
};

const validateForm = (mode: ProfileFormMode, form: ProfileFormState): FieldErrors => {
  const errors: FieldErrors = {};

  const nameErr = validateProfileId(form.name);
  if (nameErr) errors.name = nameErr;

  const model = form.model.trim();
  if (!model) errors.model = 'Model is required';

  if (form.baseUrl.trim()) {
    try {
      const url = new URL(form.baseUrl.trim());
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        errors.baseUrl = 'Base URL must start with http:// or https://';
      }
    } catch {
      errors.baseUrl = 'Base URL must be a valid URL';
    }
  }

  if (form.provider !== 'openai' && form.openaiApiMode !== 'auto') {
    errors.openaiApiMode = 'OpenAI API mode only applies to the OpenAI provider';
  }

  const timeout = parseOptionalNumber(form.timeoutSeconds);
  if (timeout.error) errors.timeoutSeconds = timeout.error;

  const temperature = parseOptionalNumber(form.temperature);
  if (temperature.error) errors.temperature = temperature.error;

  const topP = parseOptionalNumber(form.topP);
  if (topP.error) errors.topP = topP.error;

  const topK = parseOptionalInt(form.topK);
  if (topK.error) errors.topK = topK.error;

  const maxInputTokens = parseOptionalInt(form.maxInputTokens);
  if (maxInputTokens.error) errors.maxInputTokens = maxInputTokens.error;

  const maxOutputTokens = parseOptionalInt(form.maxOutputTokens);
  if (maxOutputTokens.error) errors.maxOutputTokens = maxOutputTokens.error;

  const inputCost = parseOptionalNumber(form.inputCostPerToken);
  if (inputCost.error) errors.inputCostPerToken = inputCost.error;

  const outputCost = parseOptionalNumber(form.outputCostPerToken);
  if (outputCost.error) errors.outputCostPerToken = outputCost.error;

  return errors;
};

const buildProfileConfig = (form: ProfileFormState): LLMConfiguration => {
  const optionalStringOrNull = (raw: string): string | null => {
    const trimmed = raw.trim();
    return trimmed ? trimmed : null;
  };

  const timeoutSeconds = parseOptionalNumber(form.timeoutSeconds).value;
  const temperature = parseOptionalNumber(form.temperature).value;
  const topP = parseOptionalNumber(form.topP).value;
  const topK = parseOptionalInt(form.topK).value;
  const maxInputTokens = parseOptionalInt(form.maxInputTokens).value;
  const maxOutputTokens = parseOptionalInt(form.maxOutputTokens).value;
  const inputCostPerToken = parseOptionalNumber(form.inputCostPerToken).value;
  const outputCostPerToken = parseOptionalNumber(form.outputCostPerToken).value;

  const provider = form.provider || undefined;
  const openaiApiMode = provider === 'openai'
    ? (form.openaiApiMode === 'auto' ? null : form.openaiApiMode)
    : null;

  return {
    provider,
    model: form.model.trim(),
    baseUrl: optionalStringOrNull(form.baseUrl),
    apiVersion: optionalStringOrNull(form.apiVersion),
    openaiApiMode,
    timeoutSeconds,
    temperature,
    topP,
    topK,
    maxInputTokens,
    maxOutputTokens,
    reasoningEffort: form.reasoningEffort ? form.reasoningEffort : null,
    reasoningSummary: form.reasoningSummary ? form.reasoningSummary : null,
    inputCostPerToken,
    outputCostPerToken,
  };
};

function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <div className="text-xs font-medium text-stone-300">
      {label}{required ? <span className="text-red-400"> *</span> : null}
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <div className="text-xs text-red-400 mt-1">{message}</div>;
}

function InputField(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  type?: string;
}) {
  return (
    <input
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      placeholder={props.placeholder}
      disabled={props.disabled}
      type={props.type ?? 'text'}
      className={`
        w-full px-3 py-2 rounded-lg
        bg-white/[0.03] border border-white/[0.06]
        text-stone-200 placeholder:text-stone-600
        focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:ring-offset-0
        disabled:opacity-50 disabled:cursor-not-allowed
      `}
    />
  );
}

function SelectField(props: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <select
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      disabled={props.disabled}
      className={`
        w-full px-3 py-2 rounded-lg
        bg-white/[0.03] border border-white/[0.06]
        text-stone-200
        focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:ring-offset-0
        disabled:opacity-50 disabled:cursor-not-allowed
      `}
    >
      {props.children}
    </select>
  );
}

export function LlmProfilesView(props: {
  isOpen: boolean;
  onClose: () => void;
  listProfiles: () => Promise<string[]>;
  loadProfile: (profileId: string) => Promise<LLMConfiguration>;
  saveProfile: (profileId: string, profile: LLMConfiguration) => Promise<void>;
  getApiKeyStatus: (profileId: string) => Promise<boolean>;
  setApiKey: (profileId: string, apiKey: string) => Promise<void>;
}) {
  const {
    isOpen,
    onClose,
    listProfiles,
    loadProfile,
    saveProfile,
    getApiKeyStatus,
    setApiKey,
  } = props;

  const panelRef = useRef<HTMLDivElement>(null);
  useCloseOnEscapeAndOutsideClick({ isOpen, onClose, ref: panelRef, delay: 100 });

  const activeProfileIdRef = useRef<string | null>(null);
  const [profiles, setProfiles] = useState<string[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [mode, setMode] = useState<ProfileFormMode>('create');
  const [form, setForm] = useState<ProfileFormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);
  const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus>({ state: 'unknown' });
  const [showApiKeyEditor, setShowApiKeyEditor] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);

  const sortedProfiles = useMemo(() => [...profiles].sort((a, b) => a.localeCompare(b)), [profiles]);

  const refreshApiKeyStatus = useCallback(async (profileId: string) => {
    if (activeProfileIdRef.current !== profileId) return;
    setApiKeyStatus({ state: 'loading' });
    try {
      const hasKey = await getApiKeyStatus(profileId);
      if (activeProfileIdRef.current !== profileId) return;
      setApiKeyStatus({ state: 'ready', hasKey });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (activeProfileIdRef.current !== profileId) return;
      setApiKeyStatus({ state: 'error', error: reason });
    }
  }, [getApiKeyStatus]);

  const refreshProfiles = useCallback(async () => {
    setLoadingList(true);
    setTopError(null);
    try {
      const next = await listProfiles();
      setProfiles(next);
    } catch (err) {
      setTopError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingList(false);
    }
  }, [listProfiles]);

  useEffect(() => {
    if (!isOpen) return;
    void refreshProfiles();
  }, [isOpen, refreshProfiles]);

  const startCreate = useCallback(() => {
    activeProfileIdRef.current = null;
    setMode('create');
    setSelectedProfileId(null);
    setForm(EMPTY_FORM);
    setErrors({});
    setSaveAttempted(false);
    setTopError(null);
    setApiKeyStatus({ state: 'unknown' });
    setShowApiKeyEditor(false);
    setApiKeyInput('');
    setApiKeySaving(false);
    setApiKeyError(null);
  }, []);

  const startEdit = useCallback(async (profileId: string) => {
    activeProfileIdRef.current = profileId;
    setMode('edit');
    setSelectedProfileId(profileId);
    setErrors({});
    setSaveAttempted(false);
    setTopError(null);
    setApiKeyError(null);
    setShowApiKeyEditor(false);
    setApiKeyInput('');
    setLoadingProfile(true);
    try {
      const config = await loadProfile(profileId);
      if (activeProfileIdRef.current !== profileId) return;
      setForm(toFormState(profileId, config));
    } catch (err) {
      if (activeProfileIdRef.current !== profileId) return;
      setTopError(err instanceof Error ? err.message : String(err));
    } finally {
      if (activeProfileIdRef.current === profileId) {
        setLoadingProfile(false);
      }
    }
    if (activeProfileIdRef.current === profileId) {
      void refreshApiKeyStatus(profileId);
    }
  }, [loadProfile, refreshApiKeyStatus]);

  const handleSave = useCallback(async () => {
    setSaveAttempted(true);
    const nextErrors = validateForm(mode, form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const profileId = form.name.trim();
    const config = buildProfileConfig(form);

    setSaving(true);
    setTopError(null);
    try {
      await saveProfile(profileId, config);
      await refreshProfiles();
      activeProfileIdRef.current = profileId;
      setMode('edit');
      setSelectedProfileId(profileId);
      void refreshApiKeyStatus(profileId);
    } catch (err) {
      setTopError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [form, mode, refreshApiKeyStatus, refreshProfiles, saveProfile]);

  const update = <K extends keyof ProfileFormState>(key: K, value: ProfileFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (saveAttempted) {
      setErrors((prev) => {
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const selectedIsActive = (candidate: string) => candidate === selectedProfileId;
  const canEditApiKey = mode === 'edit' && !!selectedProfileId && !loadingProfile;

  const apiKeyStatusLabel = (() => {
    if (!canEditApiKey) return '—';
    if (apiKeyStatus.state === 'loading') return 'Checking…';
    if (apiKeyStatus.state === 'ready') return apiKeyStatus.hasKey ? 'Set' : 'Not set';
    if (apiKeyStatus.state === 'error') return 'Error';
    return '—';
  })();

  const handleSetApiKey = useCallback(async () => {
    if (!selectedProfileId) return;
    const profileId = selectedProfileId;
    setApiKeySaving(true);
    setApiKeyError(null);
    try {
      const trimmed = apiKeyInput.trim();
      if (!trimmed) {
        setApiKeyError('API key is required');
        return;
      }
      await setApiKey(profileId, trimmed);
      setApiKeyInput('');
      setShowApiKeyEditor(false);
      setApiKeyStatus({ state: 'ready', hasKey: true });
      void refreshApiKeyStatus(profileId);
    } catch (err) {
      setApiKeyError(err instanceof Error ? err.message : String(err));
    } finally {
      setApiKeySaving(false);
    }
  }, [apiKeyInput, refreshApiKeyStatus, selectedProfileId, setApiKey]);

  const handleClearApiKey = useCallback(async () => {
    if (!selectedProfileId) return;
    const profileId = selectedProfileId;
    setApiKeySaving(true);
    setApiKeyError(null);
    try {
      await setApiKey(profileId, '');
      setApiKeyStatus({ state: 'ready', hasKey: false });
      void refreshApiKeyStatus(profileId);
    } catch (err) {
      setApiKeyError(err instanceof Error ? err.message : String(err));
    } finally {
      setApiKeySaving(false);
    }
  }, [refreshApiKeyStatus, selectedProfileId, setApiKey]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className="relative ml-auto w-full max-w-5xl h-full bg-[var(--vscode-editor-background)] border-l border-white/[0.08] shadow-2xl flex flex-col animate-slide-in-right"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
          <div className="flex items-center gap-2">
            <span className="codicon codicon-symbol-parameter text-brand-400" />
            <h2 className="text-lg font-semibold text-stone-100">LLM Profiles</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-9 w-9 rounded-lg bg-white/[0.04] border border-white/[0.06] text-stone-400 hover:text-stone-100 hover:bg-white/[0.08] transition-all flex items-center justify-center"
            aria-label="Close profiles view"
            title="Close"
          >
            <span className="codicon codicon-close" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden flex">
          {/* Left: list */}
          <div className="w-64 border-r border-white/[0.08] flex flex-col">
            <div className="p-4 border-b border-white/[0.06] flex items-center gap-2">
              <button
                type="button"
                onClick={startCreate}
                className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-b from-brand-500/25 to-brand-600/20 text-brand-200 border border-brand-500/30 hover:from-brand-500/35 hover:to-brand-600/30 hover:border-brand-500/40 transition-all"
              >
                <span className="codicon codicon-add" />
                New profile
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {loadingList ? (
                <div className="text-sm text-stone-500 px-2 py-2">Loading profiles…</div>
              ) : sortedProfiles.length === 0 ? (
                <div className="px-2 py-3">
                  <div className="text-sm text-stone-300 mb-1">No profiles found</div>
                  <div className="text-xs text-stone-500">Create one to get started.</div>
                </div>
              ) : (
                sortedProfiles.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => { void startEdit(id); }}
                    className={`
                      w-full text-left px-3 py-2 rounded-lg
                      text-sm font-mono
                      transition-colors
                      border
                      ${selectedIsActive(id)
                        ? 'bg-brand-500/15 border-brand-500/25 text-brand-200'
                        : 'bg-white/[0.02] border-white/[0.04] text-stone-300 hover:bg-white/[0.05] hover:border-white/[0.08]'}
                    `}
                    aria-label={`Edit profile ${id}`}
                    title={id}
                  >
                    {id}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Right: editor */}
          <div className="flex-1 overflow-y-auto p-6">
            {topError && (
              <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {topError}
              </div>
            )}

            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <div className="text-sm text-stone-500">
                  {mode === 'create' ? 'Create a new profile' : 'Edit profile'}
                </div>
                <div className="text-lg font-semibold text-stone-100 mt-1">
                  {mode === 'create' ? (form.name.trim() ? form.name.trim() : 'New profile') : (selectedProfileId ?? '—')}
                </div>
              </div>
              <button
                type="button"
                onClick={() => { void handleSave(); }}
                disabled={saving || loadingProfile}
                className={`
                  inline-flex items-center gap-2 px-4 py-2 rounded-lg
                  text-sm font-medium
                  transition-all
                  border
                  ${saving || loadingProfile
                    ? 'bg-white/[0.03] text-stone-500 border-white/[0.06] cursor-not-allowed'
                    : 'bg-gradient-to-b from-brand-500/25 to-brand-600/20 text-brand-200 border-brand-500/30 hover:from-brand-500/35 hover:to-brand-600/30 hover:border-brand-500/40'}
                `}
              >
                <span className={`codicon codicon-${saving ? 'loading' : 'save'} ${saving ? 'animate-spin' : ''}`} />
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>

            {loadingProfile ? (
              <div className="text-sm text-stone-500">Loading profile…</div>
            ) : (
              <div className="space-y-6">
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium text-stone-200">API key</div>
                      <div className="text-xs text-stone-500 mt-0.5">
                        Stored in VS Code Secret Storage. Not saved to disk.
                      </div>
                    </div>

                    {canEditApiKey ? (
                      <div className="flex items-center gap-2">
                        <div className="text-xs text-stone-400">{apiKeyStatusLabel}</div>
                        <button
                          type="button"
                          onClick={() => {
                            setApiKeyError(null);
                            setShowApiKeyEditor(true);
                          }}
                          disabled={apiKeySaving}
                          className={`
                            inline-flex items-center gap-2 px-3 py-1.5 rounded-lg
                            text-xs font-medium
                            transition-all
                            border
                            ${apiKeySaving
                              ? 'bg-white/[0.03] text-stone-500 border-white/[0.06] cursor-not-allowed'
                              : 'bg-white/[0.04] text-stone-300 border-white/[0.06] hover:bg-white/[0.08] hover:border-white/[0.1]'}
                          `}
                        >
                          <span className="codicon codicon-key" />
                          Set key…
                        </button>
                        {apiKeyStatus.state === 'ready' && apiKeyStatus.hasKey && (
                          <button
                            type="button"
                            onClick={() => { void handleClearApiKey(); }}
                            disabled={apiKeySaving}
                            className={`
                              inline-flex items-center gap-2 px-3 py-1.5 rounded-lg
                              text-xs font-medium
                              transition-all
                              border
                              ${apiKeySaving
                                ? 'bg-white/[0.03] text-stone-500 border-white/[0.06] cursor-not-allowed'
                                : 'bg-red-500/10 text-red-200 border-red-500/20 hover:bg-red-500/15 hover:border-red-500/30'}
                            `}
                          >
                            <span className="codicon codicon-trash" />
                            Clear
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="text-xs text-stone-500">Save profile to set a key.</div>
                    )}
                  </div>

                  {canEditApiKey && apiKeyStatus.state === 'error' && (
                    <div className="mt-2 text-xs text-red-400">{apiKeyStatus.error}</div>
                  )}
                  {canEditApiKey && apiKeyError && (
                    <div className="mt-2 text-xs text-red-400">{apiKeyError}</div>
                  )}

                  {canEditApiKey && showApiKeyEditor && (
                    <div className="mt-3">
                      <FieldLabel label="New API key" required />
                      <div className="mt-2">
                        <InputField
                          value={apiKeyInput}
                          onChange={setApiKeyInput}
                          placeholder="(hidden)"
                          type="password"
                        />
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => { void handleSetApiKey(); }}
                          disabled={apiKeySaving}
                          className={`
                            inline-flex items-center gap-2 px-3 py-2 rounded-lg
                            text-xs font-medium
                            transition-all
                            border
                            ${apiKeySaving
                              ? 'bg-white/[0.03] text-stone-500 border-white/[0.06] cursor-not-allowed'
                              : 'bg-gradient-to-b from-brand-500/25 to-brand-600/20 text-brand-200 border-brand-500/30 hover:from-brand-500/35 hover:to-brand-600/30 hover:border-brand-500/40'}
                          `}
                        >
                          <span className={`codicon codicon-${apiKeySaving ? 'loading' : 'save'} ${apiKeySaving ? 'animate-spin' : ''}`} />
                          Save key
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowApiKeyEditor(false);
                            setApiKeyInput('');
                            setApiKeyError(null);
                          }}
                          disabled={apiKeySaving}
                          className={`
                            inline-flex items-center gap-2 px-3 py-2 rounded-lg
                            text-xs font-medium
                            transition-all
                            border
                            ${apiKeySaving
                              ? 'bg-white/[0.03] text-stone-500 border-white/[0.06] cursor-not-allowed'
                              : 'bg-white/[0.04] text-stone-300 border-white/[0.06] hover:bg-white/[0.08] hover:border-white/[0.1]'}
                          `}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <FieldLabel label="Name" required />
                    <div className="mt-2">
                      <InputField
                        value={form.name}
                        onChange={(v) => update('name', v)}
                        placeholder="e.g. gpt-5"
                        disabled={mode === 'edit'}
                      />
                      <FieldError message={errors.name} />
                    </div>
                  </div>

                  <div>
                    <FieldLabel label="Provider" />
                    <div className="mt-2">
                      <SelectField
                        value={form.provider}
                        onChange={(v) => update('provider', v as ProfileFormState['provider'])}
                      >
                        <option value="">Select…</option>
                        <option value="openai">openai</option>
                        <option value="anthropic">anthropic</option>
                        <option value="openrouter">openrouter</option>
                        <option value="litellm_proxy">litellm_proxy</option>
                        <option value="gemini">gemini</option>
                      </SelectField>
                      <FieldError message={errors.provider} />
                    </div>
                  </div>

                  <div className="col-span-2">
                    <FieldLabel label="Model" required />
                    <div className="mt-2">
                      <InputField
                        value={form.model}
                        onChange={(v) => update('model', v)}
                        placeholder="e.g. gpt-5, claude-4-sonnet, gemini-2.5-pro"
                      />
                      <FieldError message={errors.model} />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <FieldLabel label="Base URL" />
                    <div className="mt-2">
                      <InputField
                        value={form.baseUrl}
                        onChange={(v) => update('baseUrl', v)}
                        placeholder="https://api.openai.com/v1"
                      />
                      <FieldError message={errors.baseUrl} />
                    </div>
                  </div>

                  <div>
                    <FieldLabel label="API Version" />
                    <div className="mt-2">
                      <InputField
                        value={form.apiVersion}
                        onChange={(v) => update('apiVersion', v)}
                        placeholder="optional"
                      />
                      <FieldError message={errors.apiVersion} />
                    </div>
                  </div>

                  <div>
                    <FieldLabel label="OpenAI API mode" />
                    <div className="mt-2">
                      <SelectField
                        value={form.openaiApiMode}
                        onChange={(v) => update('openaiApiMode', v as ProfileFormState['openaiApiMode'])}
                        disabled={form.provider !== 'openai'}
                      >
                        <option value="auto">auto</option>
                        <option value="chat_completions">chat_completions</option>
                        <option value="responses">responses</option>
                      </SelectField>
                      <FieldError message={errors.openaiApiMode} />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <FieldLabel label="Timeout (seconds)" />
                    <div className="mt-2">
                      <InputField value={form.timeoutSeconds} onChange={(v) => update('timeoutSeconds', v)} placeholder="60" />
                      <FieldError message={errors.timeoutSeconds} />
                    </div>
                  </div>
                  <div>
                    <FieldLabel label="Temperature" />
                    <div className="mt-2">
                      <InputField value={form.temperature} onChange={(v) => update('temperature', v)} placeholder="0.2" />
                      <FieldError message={errors.temperature} />
                    </div>
                  </div>
                  <div>
                    <FieldLabel label="Top P" />
                    <div className="mt-2">
                      <InputField value={form.topP} onChange={(v) => update('topP', v)} placeholder="1" />
                      <FieldError message={errors.topP} />
                    </div>
                  </div>
                  <div>
                    <FieldLabel label="Top K" />
                    <div className="mt-2">
                      <InputField value={form.topK} onChange={(v) => update('topK', v)} placeholder="optional" />
                      <FieldError message={errors.topK} />
                    </div>
                  </div>
                  <div>
                    <FieldLabel label="Max input tokens" />
                    <div className="mt-2">
                      <InputField value={form.maxInputTokens} onChange={(v) => update('maxInputTokens', v)} placeholder="optional" />
                      <FieldError message={errors.maxInputTokens} />
                    </div>
                  </div>
                  <div>
                    <FieldLabel label="Max output tokens" />
                    <div className="mt-2">
                      <InputField value={form.maxOutputTokens} onChange={(v) => update('maxOutputTokens', v)} placeholder="optional" />
                      <FieldError message={errors.maxOutputTokens} />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <FieldLabel label="Reasoning effort" />
                    <div className="mt-2">
                      <SelectField
                        value={form.reasoningEffort}
                        onChange={(v) => update('reasoningEffort', v as ProfileFormState['reasoningEffort'])}
                      >
                        <option value="">default</option>
                        <option value="none">none</option>
                        <option value="low">low</option>
                        <option value="medium">medium</option>
                        <option value="high">high</option>
                      </SelectField>
                      <FieldError message={errors.reasoningEffort} />
                    </div>
                  </div>
                  <div>
                    <FieldLabel label="Reasoning summary" />
                    <div className="mt-2">
                      <SelectField
                        value={form.reasoningSummary}
                        onChange={(v) => update('reasoningSummary', v as ProfileFormState['reasoningSummary'])}
                      >
                        <option value="">default</option>
                        <option value="auto">auto</option>
                        <option value="concise">concise</option>
                        <option value="detailed">detailed</option>
                      </SelectField>
                      <FieldError message={errors.reasoningSummary} />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <FieldLabel label="Input cost per token" />
                    <div className="mt-2">
                      <InputField value={form.inputCostPerToken} onChange={(v) => update('inputCostPerToken', v)} placeholder="optional" />
                      <FieldError message={errors.inputCostPerToken} />
                    </div>
                  </div>
                  <div>
                    <FieldLabel label="Output cost per token" />
                    <div className="mt-2">
                      <InputField value={form.outputCostPerToken} onChange={(v) => update('outputCostPerToken', v)} placeholder="optional" />
                      <FieldError message={errors.outputCostPerToken} />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
