import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../components/App';
import { postToWindow } from './testUtils';

const mockApi = { postMessage: vi.fn() };

const getLastPostedOfType = (type: string): any | null => {
  const calls = mockApi.postMessage.mock.calls.map((call) => call[0]);
  for (let i = calls.length - 1; i >= 0; i--) {
    const candidate = calls[i];
    if (candidate?.type === type) return candidate;
  }
  return null;
};

describe('LLM Profiles view', () => {
  beforeEach(() => {
    // @ts-expect-error mock VS Code API
    window.acquireVsCodeApi = () => mockApi;
    mockApi.postMessage.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('supports per-profile API key configuration', async () => {
    render(<App />);
    mockApi.postMessage.mockClear();

    fireEvent.click(screen.getByLabelText('LLM Profiles'));

    await waitFor(() => {
      expect(getLastPostedOfType('llmProfilesListRequest')).toBeTruthy();
    });

    const listRequest = getLastPostedOfType('llmProfilesListRequest');
    expect(typeof listRequest.requestId).toBe('string');

    postToWindow({ type: 'llmProfilesListResponse', requestId: listRequest.requestId, ok: true, profiles: ['gpt-5'] });

    const profileButton = await screen.findByLabelText('Edit profile gpt-5');
    fireEvent.click(profileButton);

    await waitFor(() => {
      expect(getLastPostedOfType('llmProfileLoadRequest')).toBeTruthy();
    });

    const loadRequest = getLastPostedOfType('llmProfileLoadRequest');
    expect(typeof loadRequest.requestId).toBe('string');

    postToWindow({
      type: 'llmProfileLoadResponse',
      requestId: loadRequest.requestId,
      ok: true,
      profileId: 'gpt-5',
      profile: { model: 'gpt-5', provider: 'openai' },
    });

    await waitFor(() => {
      expect(getLastPostedOfType('llmProfileApiKeyStatusRequest')).toBeTruthy();
    });

    const statusRequest = getLastPostedOfType('llmProfileApiKeyStatusRequest');
    postToWindow({
      type: 'llmProfileApiKeyStatusResponse',
      requestId: statusRequest.requestId,
      ok: true,
      profileId: 'gpt-5',
      hasKey: false,
      hasProfileKey: false,
      hasProviderKey: false,
      providerKeyName: 'OPENAI_API_KEY',
    });

    expect(await screen.findByText('Missing')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Override for this profile' }));

    expect(screen.queryByLabelText('API key override set')).toBeNull();

    const apiKeyInput = await screen.findByLabelText('API key override');
    fireEvent.change(apiKeyInput, { target: { value: 'sk-test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save key' }));

    await waitFor(() => {
      expect(getLastPostedOfType('llmProfileApiKeySetRequest')).toBeTruthy();
    });

    const setRequest = getLastPostedOfType('llmProfileApiKeySetRequest');
    expect(setRequest.profileId).toBe('gpt-5');
    expect(setRequest.apiKey).toBe('sk-test');

    postToWindow({
      type: 'llmProfileApiKeySetResponse',
      requestId: setRequest.requestId,
      ok: true,
      profileId: 'gpt-5',
    });

    await waitFor(() => {
      const latest = getLastPostedOfType('llmProfileApiKeyStatusRequest');
      expect(latest).toBeTruthy();
      expect(latest.requestId).not.toBe(statusRequest.requestId);
    });

    const statusRequest2 = getLastPostedOfType('llmProfileApiKeyStatusRequest');
    postToWindow({
      type: 'llmProfileApiKeyStatusResponse',
      requestId: statusRequest2.requestId,
      ok: true,
      profileId: 'gpt-5',
      hasKey: true,
      hasProfileKey: true,
      hasProviderKey: false,
      providerKeyName: 'OPENAI_API_KEY',
    });

    expect(await screen.findByText('Override set')).toBeInTheDocument();
    expect(await screen.findByLabelText('API key override set')).toBeInTheDocument();

    expect(screen.queryByDisplayValue('sk-test')).not.toBeInTheDocument();
  });

  it('supports a collapsible Advanced settings section', async () => {
    render(<App />);
    mockApi.postMessage.mockClear();

    fireEvent.click(screen.getByLabelText('LLM Profiles'));

    await waitFor(() => {
      expect(getLastPostedOfType('llmProfilesListRequest')).toBeTruthy();
    });

    const listRequest = getLastPostedOfType('llmProfilesListRequest');
    postToWindow({ type: 'llmProfilesListResponse', requestId: listRequest.requestId, ok: true, profiles: [] });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Show advanced settings' })).toBeInTheDocument();
    });

    expect(screen.queryByText('API Version')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show advanced settings' }));
    expect(await screen.findByText('API Version')).toBeInTheDocument();

    const topPInput = screen.getByLabelText('Top P');
    fireEvent.change(topPInput, { target: { value: 'abc' } });

    fireEvent.click(screen.getByRole('button', { name: 'Hide advanced settings' }));
    expect(screen.queryByText('API Version')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('button', { name: 'Hide advanced settings' })).toBeInTheDocument();
    expect(await screen.findByText('Must be a valid number')).toBeInTheDocument();
  });

  it('syncs Max output tokens slider with numeric input', async () => {
    render(<App />);
    mockApi.postMessage.mockClear();

    fireEvent.click(screen.getByLabelText('LLM Profiles'));

    await waitFor(() => {
      expect(getLastPostedOfType('llmProfilesListRequest')).toBeTruthy();
    });

    const listRequest = getLastPostedOfType('llmProfilesListRequest');
    postToWindow({ type: 'llmProfilesListResponse', requestId: listRequest.requestId, ok: true, profiles: [] });

    fireEvent.click(await screen.findByRole('button', { name: 'Show advanced settings' }));

    const slider = await screen.findByRole('slider', { name: 'Max output tokens (slider)' });
    const input = await screen.findByRole('spinbutton', { name: 'Max output tokens (numeric input)' });
    expect(slider).toBeDisabled();

    fireEvent.change(input, { target: { value: '2048' } });

    await waitFor(() => {
      expect(slider).not.toBeDisabled();
      expect(slider).toHaveValue('2048');
    });

    fireEvent.change(slider, { target: { value: '4096' } });

    await waitFor(() => {
      expect(input).toHaveValue(4096);
    });
  });

  it('validates Max output tokens range', async () => {
    render(<App />);
    mockApi.postMessage.mockClear();

    fireEvent.click(screen.getByLabelText('LLM Profiles'));

    await waitFor(() => {
      expect(getLastPostedOfType('llmProfilesListRequest')).toBeTruthy();
    });

    const listRequest = getLastPostedOfType('llmProfilesListRequest');
    postToWindow({ type: 'llmProfilesListResponse', requestId: listRequest.requestId, ok: true, profiles: [] });

    fireEvent.click(await screen.findByRole('button', { name: 'Show advanced settings' }));

    const input = await screen.findByRole('spinbutton', { name: 'Max output tokens (numeric input)' });

    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Must be >= 1')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '70000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Must be <= 65536')).toBeInTheDocument();
  });

  it('offers header icon actions for create/edit/duplicate/delete', async () => {
    render(<App />);
    mockApi.postMessage.mockClear();

    fireEvent.click(screen.getByLabelText('LLM Profiles'));

    await waitFor(() => {
      expect(getLastPostedOfType('llmProfilesListRequest')).toBeTruthy();
    });

    const listRequest = getLastPostedOfType('llmProfilesListRequest');
    postToWindow({ type: 'llmProfilesListResponse', requestId: listRequest.requestId, ok: true, profiles: ['gpt-5'] });

    fireEvent.click(await screen.findByLabelText('Edit profile gpt-5'));

    await waitFor(() => {
      expect(getLastPostedOfType('llmProfileLoadRequest')).toBeTruthy();
    });

    const loadRequest = getLastPostedOfType('llmProfileLoadRequest');
    postToWindow({
      type: 'llmProfileLoadResponse',
      requestId: loadRequest.requestId,
      ok: true,
      profileId: 'gpt-5',
      profile: { model: 'gpt-5', provider: 'openai' },
    });

    const nameInput = await screen.findByLabelText('Name');
    expect(nameInput).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Duplicate profile' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete profile' })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Create profile' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Name')).not.toBeDisabled();
    });
    expect(screen.getByRole('button', { name: 'Duplicate profile' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete profile' })).toBeDisabled();
  });

  it('duplicates an existing profile into a new create form', async () => {
    render(<App />);
    mockApi.postMessage.mockClear();

    fireEvent.click(screen.getByLabelText('LLM Profiles'));

    await waitFor(() => {
      expect(getLastPostedOfType('llmProfilesListRequest')).toBeTruthy();
    });

    const listRequest = getLastPostedOfType('llmProfilesListRequest');
    postToWindow({ type: 'llmProfilesListResponse', requestId: listRequest.requestId, ok: true, profiles: ['gpt-5'] });

    fireEvent.click(await screen.findByLabelText('Edit profile gpt-5'));

    await waitFor(() => {
      expect(getLastPostedOfType('llmProfileLoadRequest')).toBeTruthy();
    });

    const loadRequest = getLastPostedOfType('llmProfileLoadRequest');
    postToWindow({
      type: 'llmProfileLoadResponse',
      requestId: loadRequest.requestId,
      ok: true,
      profileId: 'gpt-5',
      profile: {
        model: 'gpt-5',
        provider: 'openai',
        baseUrl: 'https://example.com/v1',
        maxOutputTokens: 2048,
      },
    });

    const nameInput = await screen.findByLabelText('Name');
    expect(nameInput).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate profile' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Name')).not.toBeDisabled();
    });

    const nameInput2 = screen.getByLabelText('Name');
    expect(nameInput2).toHaveValue('');
    expect(screen.getByLabelText('Model')).toHaveValue('gpt-5');

    const baseUrlToggle = screen.getByRole('checkbox', { name: 'Use custom base URL' });
    expect(baseUrlToggle).toBeChecked();
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://example.com/v1');

    fireEvent.click(screen.getByRole('button', { name: 'Show advanced settings' }));
    expect(await screen.findByRole('spinbutton', { name: 'Max output tokens (numeric input)' })).toHaveValue(2048);

    expect(screen.getByText('Use provider key')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Override for this profile' })).not.toBeChecked();
    expect(screen.queryByLabelText('API key override')).toBeNull();
  });

  it('deletes an existing profile and returns to create mode', async () => {
    render(<App />);
    mockApi.postMessage.mockClear();

    fireEvent.click(screen.getByLabelText('LLM Profiles'));

    await waitFor(() => {
      expect(getLastPostedOfType('llmProfilesListRequest')).toBeTruthy();
    });

    const listRequest = getLastPostedOfType('llmProfilesListRequest');
    postToWindow({ type: 'llmProfilesListResponse', requestId: listRequest.requestId, ok: true, profiles: ['gpt-5'] });

    fireEvent.click(await screen.findByLabelText('Edit profile gpt-5'));

    await waitFor(() => {
      expect(getLastPostedOfType('llmProfileLoadRequest')).toBeTruthy();
    });

    const loadRequest = getLastPostedOfType('llmProfileLoadRequest');
    postToWindow({
      type: 'llmProfileLoadResponse',
      requestId: loadRequest.requestId,
      ok: true,
      profileId: 'gpt-5',
      profile: { model: 'gpt-5', provider: 'openai' },
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Delete profile' }));

    await waitFor(() => {
      expect(getLastPostedOfType('llmProfileDeleteRequest')).toBeTruthy();
    });

    const deleteRequest = getLastPostedOfType('llmProfileDeleteRequest');
    expect(deleteRequest.profileId).toBe('gpt-5');

    postToWindow({
      type: 'llmProfileDeleteResponse',
      requestId: deleteRequest.requestId,
      ok: true,
      profileId: 'gpt-5',
    });

    await waitFor(() => {
      const latest = getLastPostedOfType('llmProfilesListRequest');
      expect(latest).toBeTruthy();
      expect(latest.requestId).not.toBe(listRequest.requestId);
    });

    const listRequest2 = getLastPostedOfType('llmProfilesListRequest');
    postToWindow({ type: 'llmProfilesListResponse', requestId: listRequest2.requestId, ok: true, profiles: [] });

    await waitFor(() => {
      expect(screen.getByPlaceholderText('e.g. gpt-5')).not.toBeDisabled();
    });
    expect(screen.getByRole('button', { name: 'Delete profile' })).toBeDisabled();
  });

  it('shows an inline missing API key warning and blocks save in create mode', async () => {
    render(<App />);
    mockApi.postMessage.mockClear();

    fireEvent.click(screen.getByLabelText('LLM Profiles'));

    await waitFor(() => {
      expect(getLastPostedOfType('llmProfilesListRequest')).toBeTruthy();
    });

    const listRequest = getLastPostedOfType('llmProfilesListRequest');
    postToWindow({ type: 'llmProfilesListResponse', requestId: listRequest.requestId, ok: true, profiles: [] });

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'gpt-5' } });
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'gpt-5' } });
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'openai' } });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Override for this profile' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('You must provide a valid API key.')).toBeInTheDocument();
    expect(getLastPostedOfType('llmProfileSaveRequest')).toBeNull();

    fireEvent.change(screen.getByLabelText('API key override'), { target: { value: 'sk-test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(getLastPostedOfType('llmProfileSaveRequest')).toBeTruthy();
    });
  });

  it('preserves the draft API key when initial key storage fails during create', async () => {
    render(<App />);
    mockApi.postMessage.mockClear();

    fireEvent.click(screen.getByLabelText('LLM Profiles'));

    await waitFor(() => {
      expect(getLastPostedOfType('llmProfilesListRequest')).toBeTruthy();
    });

    const listRequest = getLastPostedOfType('llmProfilesListRequest');
    postToWindow({ type: 'llmProfilesListResponse', requestId: listRequest.requestId, ok: true, profiles: [] });

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'gpt-5' } });
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'gpt-5' } });
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'openai' } });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Override for this profile' }));
    fireEvent.change(await screen.findByLabelText('API key override'), { target: { value: 'sk-test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(getLastPostedOfType('llmProfileSaveRequest')).toBeTruthy();
    });

    const saveRequest = getLastPostedOfType('llmProfileSaveRequest');
    postToWindow({ type: 'llmProfileSaveResponse', requestId: saveRequest.requestId, ok: true });

    await waitFor(() => {
      expect(getLastPostedOfType('llmProfileApiKeySetRequest')).toBeTruthy();
    });

    const setRequest = getLastPostedOfType('llmProfileApiKeySetRequest');
    expect(setRequest.profileId).toBe('gpt-5');
    expect(setRequest.apiKey).toBe('sk-test');
    postToWindow({ type: 'llmProfileApiKeySetResponse', requestId: setRequest.requestId, ok: false, error: 'nope' });

    await waitFor(() => {
      const latest = getLastPostedOfType('llmProfilesListRequest');
      expect(latest).toBeTruthy();
      expect(latest.requestId).not.toBe(listRequest.requestId);
    });

    const listRequest2 = getLastPostedOfType('llmProfilesListRequest');
    postToWindow({ type: 'llmProfilesListResponse', requestId: listRequest2.requestId, ok: true, profiles: ['gpt-5'] });

    await waitFor(() => {
      expect(getLastPostedOfType('llmProfileApiKeyStatusRequest')).toBeTruthy();
    });

    const statusRequest = getLastPostedOfType('llmProfileApiKeyStatusRequest');
    postToWindow({
      type: 'llmProfileApiKeyStatusResponse',
      requestId: statusRequest.requestId,
      ok: true,
      profileId: 'gpt-5',
      hasKey: false,
      hasProfileKey: false,
      hasProviderKey: false,
      providerKeyName: 'OPENAI_API_KEY',
    });

    expect(screen.getByRole('checkbox', { name: 'Override for this profile' })).toBeChecked();
    expect(await screen.findByLabelText('API key override')).toHaveValue('sk-test');
  });

  it('shows an inline missing API key warning and blocks save in edit mode', async () => {
    render(<App />);
    mockApi.postMessage.mockClear();

    fireEvent.click(screen.getByLabelText('LLM Profiles'));

    await waitFor(() => {
      expect(getLastPostedOfType('llmProfilesListRequest')).toBeTruthy();
    });

    const listRequest = getLastPostedOfType('llmProfilesListRequest');
    postToWindow({ type: 'llmProfilesListResponse', requestId: listRequest.requestId, ok: true, profiles: ['gpt-5'] });

    fireEvent.click(await screen.findByLabelText('Edit profile gpt-5'));

    await waitFor(() => {
      expect(getLastPostedOfType('llmProfileLoadRequest')).toBeTruthy();
    });

    const loadRequest = getLastPostedOfType('llmProfileLoadRequest');
    postToWindow({
      type: 'llmProfileLoadResponse',
      requestId: loadRequest.requestId,
      ok: true,
      profileId: 'gpt-5',
      profile: { model: 'gpt-5', provider: 'openai' },
    });

    await waitFor(() => {
      expect(getLastPostedOfType('llmProfileApiKeyStatusRequest')).toBeTruthy();
    });

    const statusRequest = getLastPostedOfType('llmProfileApiKeyStatusRequest');
    postToWindow({
      type: 'llmProfileApiKeyStatusResponse',
      requestId: statusRequest.requestId,
      ok: true,
      profileId: 'gpt-5',
      hasKey: false,
      hasProfileKey: false,
      hasProviderKey: false,
      providerKeyName: 'OPENAI_API_KEY',
    });

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Override for this profile' }));
    expect(await screen.findByText('You must provide a valid API key.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(getLastPostedOfType('llmProfileSaveRequest')).toBeNull();
    expect(await screen.findByLabelText('API key override')).toBeInTheDocument();
  });

  it('offers a Provider docs link based on the selected provider', async () => {
    render(<App />);
    mockApi.postMessage.mockClear();

    fireEvent.click(screen.getByLabelText('LLM Profiles'));

    await waitFor(() => {
      expect(getLastPostedOfType('llmProfilesListRequest')).toBeTruthy();
    });

    const listRequest = getLastPostedOfType('llmProfilesListRequest');
    postToWindow({ type: 'llmProfilesListResponse', requestId: listRequest.requestId, ok: true, profiles: [] });

    const providerSelect = screen.getByLabelText('Provider');

    fireEvent.change(providerSelect, { target: { value: 'openai' } });

    fireEvent.click(await screen.findByRole('button', { name: 'Provider docs' }));

    await waitFor(() => {
      expect(getLastPostedOfType('openMarkdownLink')).toBeTruthy();
    });

    expect(getLastPostedOfType('openMarkdownLink')?.href).toBe('https://platform.openai.com/docs');

    fireEvent.change(providerSelect, { target: { value: 'openrouter' } });
    fireEvent.click(screen.getByRole('button', { name: 'Provider docs' }));

    await waitFor(() => {
      expect(getLastPostedOfType('openMarkdownLink')?.href).toBe('https://openrouter.ai/docs');
    });
  });

  it('offers a Get <Provider> API Key helper action', async () => {
    render(<App />);
    mockApi.postMessage.mockClear();

    fireEvent.click(screen.getByLabelText('LLM Profiles'));

    await waitFor(() => {
      expect(getLastPostedOfType('llmProfilesListRequest')).toBeTruthy();
    });

    const listRequest = getLastPostedOfType('llmProfilesListRequest');
    postToWindow({ type: 'llmProfilesListResponse', requestId: listRequest.requestId, ok: true, profiles: [] });

    const providerSelect = screen.getByLabelText('Provider');

    fireEvent.change(providerSelect, { target: { value: 'openai' } });

    fireEvent.click(await screen.findByRole('button', { name: 'Get OpenAI API Key' }));

    await waitFor(() => {
      expect(getLastPostedOfType('openMarkdownLink')?.href).toBe('https://platform.openai.com/api-keys');
    });
  });

  it('supports a Use custom base URL toggle', async () => {
    render(<App />);
    mockApi.postMessage.mockClear();

    fireEvent.click(screen.getByLabelText('LLM Profiles'));

    await waitFor(() => {
      expect(getLastPostedOfType('llmProfilesListRequest')).toBeTruthy();
    });

    const listRequest = getLastPostedOfType('llmProfilesListRequest');
    postToWindow({ type: 'llmProfilesListResponse', requestId: listRequest.requestId, ok: true, profiles: [] });

    expect(screen.queryByLabelText('Base URL')).not.toBeInTheDocument();

    const toggle = await screen.findByRole('checkbox', { name: 'Use custom base URL' });
    fireEvent.click(toggle);

    const baseUrlInput = await screen.findByLabelText('Base URL');
    fireEvent.change(baseUrlInput, { target: { value: 'https://example.com/v1' } });
    expect(baseUrlInput).toHaveValue('https://example.com/v1');

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(screen.queryByLabelText('Base URL')).not.toBeInTheDocument();
    });

    fireEvent.click(toggle);
    const baseUrlInput2 = await screen.findByLabelText('Base URL');
    expect(baseUrlInput2).toHaveValue('');
  });
});
