import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LLMConfiguration } from '@openhands/agent-sdk-ts';
import { useCloseOnEscapeAndOutsideClick } from './useCloseOnEscapeAndOutsideClick';
import { getVscodeApi } from '../shared/vscodeApi';
import type { LlmProfileApiKeyStatusInfo, LlmProfileApiKeyStatusOverrides, WebviewToHostMessage } from '../../shared/webviewMessages';
import { LlmProfileApiKeySection } from './llmProfilesView/LlmProfileApiKeySection';
import { LlmProfilesPanelHeader } from './llmProfilesView/LlmProfilesPanelHeader';
import { FieldError, FieldLabel, InputField, PopoverSelectField } from './llmProfilesView/fields';
import {
  ADVANCED_FIELD_KEYS,
  EMPTY_FORM,
  MAX_OUTPUT_TOKENS_SLIDER_MAX,
  MAX_OUTPUT_TOKENS_SLIDER_STEP,
  MIN_OUTPUT_TOKENS,
  PROVIDER_API_KEY_URLS,
  PROVIDER_DOCS_URLS,
  PROVIDER_LABELS,
  buildProfileConfig,
  parseOptionalInt,
  profileFieldId,
  toFormState,
  validateForm,
} from './llmProfilesView/formState';
import type { FieldErrors, ProfileFormMode, ProfileFormState } from './llmProfilesView/formState';

export type LlmProfilesViewOpenRequest =
  | { mode: 'create' }
  | { mode: 'edit'; profileId: string };

type ApiKeyStatus =
  | { state: 'unknown' }
  | { state: 'loading' }
  | ({ state: 'ready' } & LlmProfileApiKeyStatusInfo)
  | { state: 'error'; error: string };

const postMessage = (message: WebviewToHostMessage) => {
  const api = getVscodeApi();
  api.postMessage(message);
};

const openMarkdownLink = (href: string) => {
  postMessage({ type: 'openMarkdownLink', href });
};

const normalizeFormStateForDirtyCheck = (value: ProfileFormState) => ({
  name: value.name.trim(),
  provider: value.provider,
  model: value.model.trim(),
  baseUrl: value.baseUrl.trim(),
  apiVersion: value.apiVersion.trim(),
  openaiApiMode: value.openaiApiMode,
  timeoutSeconds: value.timeoutSeconds.trim(),
  temperature: value.temperature.trim(),
  topP: value.topP.trim(),
  topK: value.topK.trim(),
  maxInputTokens: value.maxInputTokens.trim(),
  maxOutputTokens: value.maxOutputTokens.trim(),
  reasoningEffort: value.reasoningEffort,
  reasoningSummary: value.reasoningSummary,
  inputCostPerToken: value.inputCostPerToken.trim(),
  outputCostPerToken: value.outputCostPerToken.trim(),
});

const DRAFT_PROFILE_ID = '__draft_profile__';

export function LlmProfilesView(props: {
  isOpen: boolean;
  activeProfileId?: string | null;
  onClose: () => void;
  openRequest?: LlmProfilesViewOpenRequest | null;
  listProfiles: () => Promise<string[]>;
  loadProfile: (profileId: string) => Promise<LLMConfiguration>;
  saveProfile: (profileId: string, profile: LLMConfiguration) => Promise<void>;
  deleteProfile: (profileId: string) => Promise<void>;
  getApiKeyStatus: (profileId: string, overrides?: LlmProfileApiKeyStatusOverrides) => Promise<LlmProfileApiKeyStatusInfo>;
  setApiKey: (profileId: string, apiKey: string) => Promise<void>;
  onSelectActiveProfile?: (profileId: string) => void;
}) {
  const {
    isOpen,
    activeProfileId,
    onClose,
    openRequest,
    listProfiles,
    loadProfile,
    saveProfile,
    deleteProfile,
    getApiKeyStatus,
    setApiKey,
    onSelectActiveProfile,
  } = props;

  const panelRef = useRef<HTMLDivElement>(null);
  const editorScrollRef = useRef<HTMLDivElement>(null);
  useCloseOnEscapeAndOutsideClick({ isOpen, onClose, ref: panelRef, delay: 100 });

  const nameInputRef = useRef<HTMLInputElement>(null);
  const apiKeyInputRef = useRef<HTMLInputElement>(null);

  const activeProfileIdRef = useRef<string | null>(null);
  const didInitializeSelectionRef = useRef(false);
  const lastHandledOpenRequestRef = useRef<string | null>(null);
  const [profiles, setProfiles] = useState<string[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [mode, setMode] = useState<ProfileFormMode>('create');
  const [form, setForm] = useState<ProfileFormState>(EMPTY_FORM);
  const [baselineForm, setBaselineForm] = useState<ProfileFormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);
  const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus>({ state: 'unknown' });
  const [overrideProfileApiKey, setOverrideProfileApiKey] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [useCustomBaseUrl, setUseCustomBaseUrl] = useState(false);

  const sortedProfiles = useMemo(() => [...profiles].sort((a, b) => a.localeCompare(b)), [profiles]);
  const advancedErrorCount = useMemo(() => ADVANCED_FIELD_KEYS.reduce((count, key) => (errors[key] ? count + 1 : count), 0), [errors]);
  const advancedSettingsLabelId = 'llmProfilesAdvancedSettingsLabel';
  const advancedSettingsPanelId = 'llmProfilesAdvancedSettingsPanel';

  const refreshApiKeyStatus = useCallback(async (profileId: string, overrides?: LlmProfileApiKeyStatusOverrides) => {
    if (activeProfileIdRef.current !== profileId) return;
    setApiKeyStatus({ state: 'loading' });
    try {
      const status = await getApiKeyStatus(profileId, overrides);
      if (activeProfileIdRef.current !== profileId) return;
      setApiKeyStatus({ state: 'ready', ...status });
      if (status.hasProfileKey) {
        setOverrideProfileApiKey(true);
      }
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

  type EditorTransitionTarget = {
    mode: ProfileFormMode;
    selectedProfileId: string | null;
    form: ProfileFormState;
    loadingProfile: boolean;
    useCustomBaseUrl: boolean;
  };

  const applyEditorTransition = useCallback((target: EditorTransitionTarget) => {
    setMode(target.mode);
    setSelectedProfileId(target.selectedProfileId);
    setForm(target.form);
    setBaselineForm(target.form);
    setLoadingProfile(target.loadingProfile);
    setUseCustomBaseUrl(target.useCustomBaseUrl);

    setErrors({});
    setSaveAttempted(false);
    setTopError(null);
    setApiKeyStatus({ state: 'unknown' });
    setOverrideProfileApiKey(false);
    setApiKeyInput('');
    setApiKeySaving(false);
    setApiKeyError(null);
    setIsAdvancedOpen(false);
  }, []);

  const startCreate = useCallback(() => {
    activeProfileIdRef.current = DRAFT_PROFILE_ID;
    applyEditorTransition({
      mode: 'create',
      selectedProfileId: null,
      form: EMPTY_FORM,
      loadingProfile: false,
      useCustomBaseUrl: false,
    });
  }, [applyEditorTransition]);

  const startEdit = useCallback(async (profileId: string) => {
    activeProfileIdRef.current = profileId;
    applyEditorTransition({
      mode: 'edit',
      selectedProfileId: profileId,
      form: EMPTY_FORM,
      loadingProfile: true,
      useCustomBaseUrl: false,
    });
    try {
      const config = await loadProfile(profileId);
      if (activeProfileIdRef.current !== profileId) return;
      const nextForm = toFormState(profileId, config);
      setForm(nextForm);
      setBaselineForm(nextForm);
      const initialBaseUrl = typeof config.baseUrl === 'string' ? config.baseUrl.trim() : '';
      setUseCustomBaseUrl(Boolean(initialBaseUrl));
    } catch (err) {
      if (activeProfileIdRef.current !== profileId) return;
      setTopError(err instanceof Error ? err.message : String(err));
    } finally {
      if (activeProfileIdRef.current === profileId) {
        setLoadingProfile(false);
      }
    }
  }, [applyEditorTransition, loadProfile]);

  useEffect(() => {
    if (!isOpen) {
      didInitializeSelectionRef.current = false;
      lastHandledOpenRequestRef.current = null;
      return;
    }

    const openRequestKey = (() => {
      if (!openRequest) return null;
      if (openRequest.mode === 'create') return 'create';
      if (openRequest.mode === 'edit') return `edit:${openRequest.profileId}`;
      return null;
    })();

    if (openRequest && openRequestKey && lastHandledOpenRequestRef.current !== openRequestKey) {
      lastHandledOpenRequestRef.current = openRequestKey;
      didInitializeSelectionRef.current = true;

      if (openRequest.mode === 'create') {
        startCreate();
        return;
      }
      if (openRequest.mode === 'edit') {
        void startEdit(openRequest.profileId);
        return;
      }
    }

    if (didInitializeSelectionRef.current) return;
    didInitializeSelectionRef.current = true;

    const normalizedActiveProfileId = typeof activeProfileId === 'string' ? activeProfileId.trim() : '';
    if (normalizedActiveProfileId) {
      void startEdit(normalizedActiveProfileId);
      return;
    }
    startCreate();
  }, [activeProfileId, isOpen, openRequest, startCreate, startEdit]);

  useEffect(() => {
    if (!isOpen) return;
    if (!form.provider) return;

    if (mode === 'edit') {
      if (!selectedProfileId || loadingProfile) return;
      void refreshApiKeyStatus(selectedProfileId, { provider: form.provider });
      return;
    }

    void refreshApiKeyStatus(DRAFT_PROFILE_ID, { provider: form.provider });
  }, [form.provider, isOpen, loadingProfile, mode, refreshApiKeyStatus, selectedProfileId]);

  const handleSave = useCallback(async () => {
    setSaveAttempted(true);
    const nextErrors = validateForm(mode, form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      const hasAdvancedErrors = ADVANCED_FIELD_KEYS.some((key) => Boolean(nextErrors[key]));
      if (hasAdvancedErrors) setIsAdvancedOpen(true);
      return;
    }

    const providerRequiresApiKey = Boolean(form.provider);
    const trimmedDraftApiKey = apiKeyInput.trim();
    const canEditApiKeyForSave = mode === 'edit' && !!selectedProfileId && !loadingProfile;

    if (providerRequiresApiKey && overrideProfileApiKey) {
      if (mode === 'create' && !trimmedDraftApiKey) {
        requestAnimationFrame(() => {
          apiKeyInputRef.current?.focus();
        });
        return;
      }
      if (canEditApiKeyForSave && apiKeyStatus.state === 'ready' && !apiKeyStatus.hasProfileKey) {
        requestAnimationFrame(() => {
          apiKeyInputRef.current?.focus();
        });
        return;
      }
    }

    const profileId = form.name.trim();
    const config = buildProfileConfig(form);

    setSaving(true);
    setTopError(null);
    try {
      await saveProfile(profileId, config);
      if (mode === 'create' && providerRequiresApiKey && overrideProfileApiKey && trimmedDraftApiKey) {
        try {
          await setApiKey(profileId, trimmedDraftApiKey);
          setApiKeyInput('');
        } catch (err) {
          setTopError(err instanceof Error ? err.message : String(err));
        }
      }
      await refreshProfiles();
      const nextForm = toFormState(profileId, config);
      setForm(nextForm);
      setBaselineForm(nextForm);
      activeProfileIdRef.current = profileId;
      setMode('edit');
      setSelectedProfileId(profileId);
      void refreshApiKeyStatus(profileId);
    } catch (err) {
      setTopError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [
    apiKeyInput,
    apiKeyStatus,
    form,
    loadingProfile,
    mode,
    overrideProfileApiKey,
    refreshApiKeyStatus,
    refreshProfiles,
    saveProfile,
    selectedProfileId,
    setApiKey,
  ]);

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

  const NEW_PROFILE_SELECT_VALUE = '__new__';
  const profileSelectId = profileFieldId('profile-select');
  const profileSelectValue = selectedProfileId ?? NEW_PROFILE_SELECT_VALUE;
  const profileSelectOptions = useMemo(() => {
    if (selectedProfileId && !sortedProfiles.includes(selectedProfileId)) {
      return [...sortedProfiles, selectedProfileId].sort((a, b) => a.localeCompare(b));
    }
    return sortedProfiles;
  }, [selectedProfileId, sortedProfiles]);
  const canEditApiKey = mode === 'edit' && !!selectedProfileId && !loadingProfile;
  const providerRequiresApiKey = Boolean(form.provider);
  const providerDocsUrl = form.provider ? PROVIDER_DOCS_URLS[form.provider] : null;
  const providerLabel = form.provider ? PROVIDER_LABELS[form.provider] : null;
  const providerApiKeyUrl = form.provider ? (PROVIDER_API_KEY_URLS[form.provider] ?? null) : null;
  const missingStoredApiKey = canEditApiKey && overrideProfileApiKey && apiKeyStatus.state === 'ready' && !apiKeyStatus.hasProfileKey;
  const missingDraftApiKey = mode === 'create' && saveAttempted && providerRequiresApiKey && overrideProfileApiKey && !apiKeyInput.trim();
  const showMissingApiKeyWarning = missingStoredApiKey || missingDraftApiKey;
  const maxOutputTokensSlider = (() => {
    const parsed = parseOptionalInt(form.maxOutputTokens);
    const value = parsed.value;
    if (value === null || value < MIN_OUTPUT_TOKENS || value > MAX_OUTPUT_TOKENS_SLIDER_MAX) {
      return { disabled: true, value: MIN_OUTPUT_TOKENS };
    }
    return { disabled: false, value };
  })();

  const showProviderKeyConfiguredIndicator = providerRequiresApiKey
    && !overrideProfileApiKey
    && apiKeyStatus.state === 'ready'
    && apiKeyStatus.hasProviderKey
    && !apiKeyStatus.hasProfileKey;

  const apiKeyStatusLabel = (() => {
    if (!providerRequiresApiKey) return '—';

    if (overrideProfileApiKey) {
      if (mode === 'create') {
        return apiKeyInput.trim() ? 'Draft' : 'Not set';
      }
      if (apiKeyStatus.state === 'loading') return 'Checking…';
      if (apiKeyStatus.state === 'ready') return apiKeyStatus.hasProfileKey ? 'Override set' : 'Not set';
      if (apiKeyStatus.state === 'error') return 'Error';
      return '—';
    }

    // Using provider key (no per-profile override).
    if (apiKeyStatus.state === 'loading') return 'Checking…';
    if (apiKeyStatus.state === 'ready') return apiKeyStatus.hasProviderKey ? '' : 'Missing';
    if (apiKeyStatus.state === 'error') return 'Error';
    return mode === 'create' ? 'Use provider key' : '—';
  })();

  const showProfileApiKeyOverrideSetIndicator = canEditApiKey
    && providerRequiresApiKey
    && overrideProfileApiKey
    && apiKeyStatus.state === 'ready'
    && apiKeyStatus.hasProfileKey;
  const apiKeyStatusError = canEditApiKey && apiKeyStatus.state === 'error' ? apiKeyStatus.error : null;

  const handleSelectProfile = useCallback((next: string) => {
    if (next === NEW_PROFILE_SELECT_VALUE) {
      startCreate();
      requestAnimationFrame(() => {
        nameInputRef.current?.focus();
      });
      return;
    }
    void startEdit(next);
    onSelectActiveProfile?.(next);
  }, [onSelectActiveProfile, startCreate, startEdit]);

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
      void refreshApiKeyStatus(profileId, form.provider ? { provider: form.provider } : undefined);
    } catch (err) {
      setApiKeyError(err instanceof Error ? err.message : String(err));
    } finally {
      setApiKeySaving(false);
    }
  }, [apiKeyInput, form.provider, refreshApiKeyStatus, selectedProfileId, setApiKey]);

  const handleClearApiKey = useCallback(async () => {
    if (!selectedProfileId) return;
    const profileId = selectedProfileId;
    setApiKeySaving(true);
    setApiKeyError(null);
    try {
      await setApiKey(profileId, '');
      void refreshApiKeyStatus(profileId, form.provider ? { provider: form.provider } : undefined);
    } catch (err) {
      setApiKeyError(err instanceof Error ? err.message : String(err));
    } finally {
      setApiKeySaving(false);
    }
  }, [form.provider, refreshApiKeyStatus, selectedProfileId, setApiKey]);

  const handleToggleOverrideProfileApiKey = useCallback((next: boolean) => {
    setOverrideProfileApiKey(next);
    setApiKeyError(null);
    setApiKeyInput('');
    if (!next && mode === 'edit') {
      void handleClearApiKey();
      return;
    }
    if (next) {
      requestAnimationFrame(() => {
        apiKeyInputRef.current?.focus();
      });
    }
  }, [handleClearApiKey, mode]);

  const handleDeleteProfile = useCallback(async () => {
    if (mode !== 'edit' || !selectedProfileId) return;
    const profileId = selectedProfileId;
    setDeleting(true);
    setTopError(null);
    try {
      await deleteProfile(profileId);
      await refreshProfiles();
      startCreate();
    } catch (err) {
      setTopError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  }, [deleteProfile, mode, refreshProfiles, selectedProfileId, startCreate]);

  const handleDuplicateProfile = useCallback(() => {
    if (mode !== 'edit') return;

    const source = form;
    activeProfileIdRef.current = DRAFT_PROFILE_ID;
    const nextForm = { ...source, name: '' };
    applyEditorTransition({
      mode: 'create',
      selectedProfileId: null,
      form: nextForm,
      loadingProfile: false,
      useCustomBaseUrl: Boolean(source.baseUrl.trim()),
    });

    editorScrollRef.current?.scrollTo?.({ top: 0, behavior: 'smooth' });
    requestAnimationFrame(() => {
      nameInputRef.current?.focus();
    });
  }, [applyEditorTransition, form, mode]);

  const isDirty = useMemo(() => {
    return JSON.stringify(normalizeFormStateForDirtyCheck(form)) !== JSON.stringify(normalizeFormStateForDirtyCheck(baselineForm));
  }, [baselineForm, form]);
  const canSave = isDirty && !saving && !loadingProfile;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex" data-testid="llm-profiles-view">
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
        <LlmProfilesPanelHeader
          mode={mode}
          selectedProfileId={selectedProfileId}
          loadingProfile={loadingProfile}
          saving={saving}
          deleting={deleting}
          onCreate={startCreate}
          onDuplicate={handleDuplicateProfile}
          onDelete={handleDeleteProfile}
          onClose={onClose}
        />

        {/* Body */}
        <div className="flex-1 overflow-hidden flex">
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-6 py-5 border-b border-white/[0.06] space-y-4">
              <div>
                <FieldLabel label="Profile" htmlFor={profileSelectId} />
                <PopoverSelectField
                  id={profileSelectId}
                  value={profileSelectValue}
                  onChange={handleSelectProfile}
                  disabled={loadingList}
                  preferPlacement="down"
                  ariaLabel="Profile"
                  icon="codicon-symbol-parameter"
                  options={[
                    { value: NEW_PROFILE_SELECT_VALUE, label: 'New Profile…' },
                    ...profileSelectOptions.map((id) => ({ value: id, label: id })),
                  ]}
                />
                {loadingList ? (
                  <div className="text-xs text-stone-500 mt-1">Loading profiles…</div>
                ) : profileSelectOptions.length === 0 ? (
                  <div className="text-xs text-stone-500 mt-1">No profiles found. Create one to get started.</div>
                ) : null}
              </div>

              <div>
                <div className="text-sm text-stone-500">
                  {mode === 'create' ? 'Create a new profile' : 'Edit profile'}
                </div>
                <div className="text-lg font-semibold text-stone-100 mt-1">
                  {mode === 'create' ? (form.name.trim() ? form.name.trim() : 'New profile') : (selectedProfileId ?? '—')}
                </div>
              </div>
            </div>

            <div
              ref={editorScrollRef}
              className="flex-1 overflow-y-auto px-6 py-6"
              style={{ scrollbarGutter: 'stable' }}
            >
              {topError && (
                <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {topError}
                </div>
              )}

              {loadingProfile ? (
                <div className="text-sm text-stone-500">Loading profile…</div>
              ) : (
                <div className="space-y-6">
                  <LlmProfileApiKeySection
                    mode={mode}
                    providerLabel={providerLabel}
                    providerApiKeyUrl={providerApiKeyUrl}
                    providerRequiresApiKey={providerRequiresApiKey}
                    openMarkdownLink={openMarkdownLink}
                    showProviderKeyConfiguredIndicator={showProviderKeyConfiguredIndicator}
                    apiKeyStatusLabel={apiKeyStatusLabel}
                    overrideProfileApiKey={overrideProfileApiKey}
                    onToggleOverrideProfileApiKey={handleToggleOverrideProfileApiKey}
                    canEditApiKey={canEditApiKey}
                    apiKeySaving={apiKeySaving}
                    showMissingApiKeyWarning={showMissingApiKeyWarning}
                    apiKeyInputRef={apiKeyInputRef}
                    apiKeyInput={apiKeyInput}
                    setApiKeyInput={setApiKeyInput}
                    apiKeyStatusError={apiKeyStatusError}
                    apiKeyError={apiKeyError}
                    showProfileApiKeyOverrideSetIndicator={showProfileApiKeyOverrideSetIndicator}
                    onSaveApiKey={handleSetApiKey}
                  />

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <FieldLabel label="Name" required htmlFor={profileFieldId('name')} />
                    <div className="mt-2">
                      <InputField
                        ref={nameInputRef}
                        id={profileFieldId('name')}
                        value={form.name}
                        onChange={(v) => update('name', v)}
                        placeholder="e.g. gpt-5"
                        disabled={mode === 'edit'}
                      />
                      <FieldError message={errors.name} />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <FieldLabel label="Provider" htmlFor={profileFieldId('provider')} />
                      {providerDocsUrl && (
                        <button
                          type="button"
                          onClick={() => openMarkdownLink(providerDocsUrl)}
                          className="text-xs text-brand-300 underline decoration-white/20 hover:decoration-white/40 hover:text-brand-200 transition-colors"
                          aria-label="Provider docs"
                          title="Open provider docs"
                        >
                          Provider docs <span className="codicon codicon-link-external text-[11px]" />
                        </button>
                      )}
                    </div>
                    <div className="mt-2">
                      <PopoverSelectField
                        id={profileFieldId('provider')}
                        value={form.provider}
                        onChange={(v) => update('provider', v as ProfileFormState['provider'])}
                        preferPlacement="down"
                        ariaLabel="Provider"
                        icon="codicon-plug"
                        options={[
                          { value: '', label: 'Select…' },
                          { value: 'openai', label: 'openai' },
                          { value: 'anthropic', label: 'anthropic' },
                          { value: 'openrouter', label: 'openrouter' },
                          { value: 'litellm_proxy', label: 'litellm_proxy' },
                          { value: 'gemini', label: 'gemini' },
                        ]}
                      />
                      <FieldError message={errors.provider} />
                    </div>
                  </div>

                  <div className="col-span-2">
                    <FieldLabel label="Model" required htmlFor={profileFieldId('model')} />
                    <div className="mt-2">
                      <InputField
                        id={profileFieldId('model')}
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
                    <div className="flex items-center justify-between gap-3">
                      <FieldLabel
                        label="Base URL"
                        htmlFor={useCustomBaseUrl ? profileFieldId('baseUrl') : undefined}
                      />
                      <label className="flex items-center gap-2 text-xs text-stone-300 select-none">
                        <input
                          type="checkbox"
                          checked={useCustomBaseUrl}
                          onChange={(e) => {
                            const next = e.target.checked;
                            setUseCustomBaseUrl(next);
                            if (!next) update('baseUrl', '');
                          }}
                          className="h-4 w-4 rounded border border-white/[0.2] bg-white/[0.02] text-brand-500 oh-focus-outline"
                        />
                        Use custom base URL
                      </label>
                    </div>
                    {useCustomBaseUrl ? (
                      <div className="mt-2">
                        <InputField
                          id={profileFieldId('baseUrl')}
                          value={form.baseUrl}
                          onChange={(v) => update('baseUrl', v)}
                          placeholder="https://api.openai.com/v1"
                        />
                        <FieldError message={errors.baseUrl} />
                      </div>
                    ) : (
                      <div className="mt-2 text-xs text-stone-500">
                        Using provider default.
                      </div>
                    )}
                  </div>

                  <div>
                    <FieldLabel label="OpenAI API mode" htmlFor={profileFieldId('openaiApiMode')} />
                    <div className="mt-2">
                      <PopoverSelectField
                        id={profileFieldId('openaiApiMode')}
                        value={form.openaiApiMode}
                        onChange={(v) => update('openaiApiMode', v as ProfileFormState['openaiApiMode'])}
                        disabled={form.provider !== 'openai'}
                        preferPlacement="up"
                        ariaLabel="OpenAI API mode"
                        icon="codicon-json"
                        options={[
                          { value: 'auto', label: 'auto' },
                          { value: 'chat_completions', label: 'chat_completions' },
                          { value: 'responses', label: 'responses' },
                        ]}
                      />
                      <FieldError message={errors.openaiApiMode} />
                    </div>
                  </div>

                  <div>
                    <FieldLabel label="Temperature" htmlFor={profileFieldId('temperature')} />
                    <div className="mt-2">
                      <InputField
                        id={profileFieldId('temperature')}
                        value={form.temperature}
                        onChange={(v) => update('temperature', v)}
                        placeholder="0.2"
                      />
                      <FieldError message={errors.temperature} />
                    </div>
                  </div>
                </div>

                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setIsAdvancedOpen((prev) => !prev)}
                    className="w-full flex items-center justify-between gap-3 text-left"
                    aria-label={isAdvancedOpen ? 'Hide advanced settings' : 'Show advanced settings'}
                    aria-expanded={isAdvancedOpen}
                    aria-controls={advancedSettingsPanelId}
                    title={isAdvancedOpen ? 'Hide advanced settings' : 'Show advanced settings'}
                  >
                    <div className="flex items-center gap-2">
                      <span className="codicon codicon-settings text-stone-400" />
                      <span id={advancedSettingsLabelId} className="text-sm font-medium text-stone-200">Advanced settings</span>
                      {advancedErrorCount > 0 && !isAdvancedOpen && (
                        <span className="ml-1 text-[11px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-200 border border-red-500/20">
                          {advancedErrorCount} issue{advancedErrorCount === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                    <span className={`codicon codicon-chevron-${isAdvancedOpen ? 'up' : 'down'} text-[10px] text-stone-400`} />
                  </button>

                  {isAdvancedOpen && (
                    <div
                      id={advancedSettingsPanelId}
                      role="region"
                      aria-labelledby={advancedSettingsLabelId}
                      className="mt-4 space-y-6"
                    >
                      <div>
                        <FieldLabel label="API Version" htmlFor={profileFieldId('apiVersion')} />
                        <div className="mt-2">
                          <InputField
                            id={profileFieldId('apiVersion')}
                            value={form.apiVersion}
                            onChange={(v) => update('apiVersion', v)}
                            placeholder="optional"
                          />
                          <FieldError message={errors.apiVersion} />
                        </div>
                        </div>

                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <FieldLabel label="Timeout (seconds)" htmlFor={profileFieldId('timeoutSeconds')} />
                            <div className="mt-2">
                              <InputField
                                id={profileFieldId('timeoutSeconds')}
                                value={form.timeoutSeconds}
                                onChange={(v) => update('timeoutSeconds', v)}
                                placeholder="60"
                              />
                              <FieldError message={errors.timeoutSeconds} />
                            </div>
                          </div>
                          <div>
                            <FieldLabel label="Top P" htmlFor={profileFieldId('topP')} />
                            <div className="mt-2">
                            <InputField
                              id={profileFieldId('topP')}
                              value={form.topP}
                              onChange={(v) => update('topP', v)}
                              placeholder="1"
                            />
                            <FieldError message={errors.topP} />
                          </div>
                        </div>
                        <div>
                          <FieldLabel label="Top K" htmlFor={profileFieldId('topK')} />
                          <div className="mt-2">
                            <InputField
                              id={profileFieldId('topK')}
                              value={form.topK}
                              onChange={(v) => update('topK', v)}
                              placeholder="optional"
                            />
                            <FieldError message={errors.topK} />
                          </div>
                        </div>
                        <div>
                          <FieldLabel label="Max input tokens" htmlFor={profileFieldId('maxInputTokens')} />
                          <div className="mt-2">
                            <InputField
                              id={profileFieldId('maxInputTokens')}
                              value={form.maxInputTokens}
                              onChange={(v) => update('maxInputTokens', v)}
                              placeholder="optional"
                            />
                            <FieldError message={errors.maxInputTokens} />
                          </div>
                        </div>
                        <div>
                          <FieldLabel label="Max output tokens" htmlFor={profileFieldId('maxOutputTokens')} />
                          <div className="mt-2">
                            <div className="space-y-2">
                              <InputField
                                id={profileFieldId('maxOutputTokens')}
                                value={form.maxOutputTokens}
                                onChange={(v) => update('maxOutputTokens', v)}
                                placeholder="optional"
                                type="number"
                                ariaLabel="Max output tokens (numeric input)"
                              />
                              <input
                                type="range"
                                min={MIN_OUTPUT_TOKENS}
                                max={MAX_OUTPUT_TOKENS_SLIDER_MAX}
                                step={MAX_OUTPUT_TOKENS_SLIDER_STEP}
                                value={maxOutputTokensSlider.value}
                                onChange={(e) => update('maxOutputTokens', e.target.value)}
                                disabled={maxOutputTokensSlider.disabled}
                                aria-label="Max output tokens (slider)"
                                className="
                                  w-full h-2 rounded-lg
                                  appearance-none bg-transparent
                                  oh-focus-outline
                                  disabled:opacity-50 disabled:cursor-not-allowed
                                  [&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:rounded-lg [&::-webkit-slider-runnable-track]:bg-white/10
                                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:-mt-1
                                  [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-stone-300 [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-white/20
                                  [&::-moz-range-track]:h-2 [&::-moz-range-track]:rounded-lg [&::-moz-range-track]:bg-white/10
                                  [&::-moz-range-progress]:h-2 [&::-moz-range-progress]:rounded-lg [&::-moz-range-progress]:bg-white/20
                                  [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-stone-300
                                  [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-white/20
                                "
                              />
                              <div className="flex items-center justify-between text-[11px] text-stone-500">
                                <span>{MIN_OUTPUT_TOKENS}</span>
                                <span>{MAX_OUTPUT_TOKENS_SLIDER_MAX.toLocaleString()}</span>
                              </div>
                            </div>
                            <FieldError message={errors.maxOutputTokens} />
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <FieldLabel label="Reasoning effort" htmlFor={profileFieldId('reasoningEffort')} />
                          <div className="mt-2">
                            <PopoverSelectField
                              id={profileFieldId('reasoningEffort')}
                              value={form.reasoningEffort}
                              onChange={(v) => update('reasoningEffort', v as ProfileFormState['reasoningEffort'])}
                              preferPlacement="up"
                              ariaLabel="Reasoning effort"
                              icon="codicon-lightbulb"
                              options={[
                                { value: '', label: 'default' },
                                { value: 'none', label: 'none' },
                                { value: 'low', label: 'low' },
                                { value: 'medium', label: 'medium' },
                                { value: 'high', label: 'high' },
                              ]}
                            />
                            <FieldError message={errors.reasoningEffort} />
                          </div>
                        </div>
                        <div>
                          <FieldLabel label="Reasoning summary" htmlFor={profileFieldId('reasoningSummary')} />
                          <div className="mt-2">
                            <PopoverSelectField
                              id={profileFieldId('reasoningSummary')}
                              value={form.reasoningSummary}
                              onChange={(v) => update('reasoningSummary', v as ProfileFormState['reasoningSummary'])}
                              preferPlacement="up"
                              ariaLabel="Reasoning summary"
                              icon="codicon-preview"
                              options={[
                                { value: '', label: 'default' },
                                { value: 'auto', label: 'auto' },
                                { value: 'concise', label: 'concise' },
                                { value: 'detailed', label: 'detailed' },
                              ]}
                            />
                            <FieldError message={errors.reasoningSummary} />
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <FieldLabel label="Input cost per token" htmlFor={profileFieldId('inputCostPerToken')} />
                          <div className="mt-2">
                            <InputField
                              id={profileFieldId('inputCostPerToken')}
                              value={form.inputCostPerToken}
                              onChange={(v) => update('inputCostPerToken', v)}
                              placeholder="optional"
                            />
                            <FieldError message={errors.inputCostPerToken} />
                          </div>
                        </div>
                        <div>
                          <FieldLabel label="Output cost per token" htmlFor={profileFieldId('outputCostPerToken')} />
                          <div className="mt-2">
                            <InputField
                              id={profileFieldId('outputCostPerToken')}
                              value={form.outputCostPerToken}
                              onChange={(v) => update('outputCostPerToken', v)}
                              placeholder="optional"
                            />
                            <FieldError message={errors.outputCostPerToken} />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-white/[0.06] bg-[var(--vscode-editor-background)]">
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="
                    inline-flex items-center gap-2 px-4 py-2 rounded-lg
                    text-sm font-medium
                    transition-all
                    border border-white/[0.06]
                    bg-white/[0.04] text-stone-300
                    hover:bg-white/[0.08] hover:border-white/[0.1]
                    focus:outline-none focus:ring-0
                    focus-visible:shadow-[0_0_0_1px_rgba(232,166,66,0.08)]
                  "
                >
                  {isDirty ? 'Cancel' : 'Close'}
                </button>
                <button
                  type="button"
                  onClick={() => { void handleSave(); }}
                  disabled={!canSave}
                  className={`
                    inline-flex items-center gap-2 px-4 py-2 rounded-lg
                    text-sm font-medium
                    transition-all
                    border
                    focus:outline-none focus:ring-0
                    focus-visible:shadow-[0_0_0_1px_rgba(232,166,66,0.08)]
                    ${!canSave
                      ? 'bg-white/[0.03] text-stone-500 border-white/[0.06] cursor-not-allowed'
                      : 'bg-gradient-to-b from-brand-500/25 to-brand-600/20 text-brand-200 border-white/[0.06] oh-outline-soft hover:from-brand-500/35 hover:to-brand-600/30 hover:border-white/[0.1]'}
                  `}
                >
                  <span className={`codicon codicon-${saving ? 'loading' : 'save'} ${saving ? 'animate-spin' : ''}`} />
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
