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
    });

    expect(await screen.findByText('Not set')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Set key…' }));

    const apiKeyInput = await screen.findByPlaceholderText('(hidden)');
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
    });

    expect(await screen.findByText('Set')).toBeInTheDocument();

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

    const topPInput = screen.getByPlaceholderText('1');
    fireEvent.change(topPInput, { target: { value: 'abc' } });

    fireEvent.click(screen.getByRole('button', { name: 'Hide advanced settings' }));
    expect(screen.queryByText('API Version')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('button', { name: 'Hide advanced settings' })).toBeInTheDocument();
    expect(await screen.findByText('Must be a valid number')).toBeInTheDocument();
  });

  it('offers header icon actions for create/edit (delete disabled)', async () => {
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

    const nameInput = await screen.findByPlaceholderText('e.g. gpt-5');
    expect(nameInput).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Create profile' }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('e.g. gpt-5')).not.toBeDisabled();
    });
    expect(screen.getByRole('button', { name: 'Edit profile' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete profile' })).toBeDisabled();
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

    const providerSelect = screen.getAllByRole('combobox').find((candidate) => (
      candidate.querySelector('option[value="openai"]') !== null
    ));
    if (!providerSelect) throw new Error('Failed to find provider select');

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

    const providerSelect = screen.getAllByRole('combobox').find((candidate) => (
      candidate.querySelector('option[value="openai"]') !== null
    ));
    if (!providerSelect) throw new Error('Failed to find provider select');

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

    expect(screen.queryByPlaceholderText('https://api.openai.com/v1')).not.toBeInTheDocument();

    const toggle = await screen.findByRole('checkbox', { name: 'Use custom base URL' });
    fireEvent.click(toggle);

    const baseUrlInput = await screen.findByPlaceholderText('https://api.openai.com/v1');
    fireEvent.change(baseUrlInput, { target: { value: 'https://example.com/v1' } });
    expect(baseUrlInput).toHaveValue('https://example.com/v1');

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(screen.queryByPlaceholderText('https://api.openai.com/v1')).not.toBeInTheDocument();
    });

    fireEvent.click(toggle);
    const baseUrlInput2 = await screen.findByPlaceholderText('https://api.openai.com/v1');
    expect(baseUrlInput2).toHaveValue('');
  });
});
