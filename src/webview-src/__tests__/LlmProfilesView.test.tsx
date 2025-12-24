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
});
