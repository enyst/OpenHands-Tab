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

describe('LLM profile dropdown', () => {
  beforeEach(() => {
    // @ts-expect-error mock VS Code API
    window.acquireVsCodeApi = () => mockApi;
    mockApi.postMessage.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('includes a New profile… option that opens the Profiles view in create mode', async () => {
    render(<App />);
    mockApi.postMessage.mockClear();

    postToWindow({ type: 'llmProfilesUpdated', profiles: ['gpt-5'], activeProfileId: 'gpt-5' });

    fireEvent.click(screen.getByLabelText('LLM profile'));
    fireEvent.click(await screen.findByLabelText('New profile…'));

    await screen.findByText('OpenHands - LLM Profiles');
    expect(screen.getByText('Create a new profile')).toBeInTheDocument();

    await waitFor(() => {
      expect(getLastPostedOfType('llmProfilesListRequest')).toBeTruthy();
    });

    const listRequest = getLastPostedOfType('llmProfilesListRequest');
    postToWindow({ type: 'llmProfilesListResponse', requestId: listRequest.requestId, ok: true, profiles: ['gpt-5'] });
  });

  it('opens the Profiles view in create mode when no profiles exist', async () => {
    render(<App />);
    mockApi.postMessage.mockClear();

    postToWindow({ type: 'llmProfilesUpdated', profiles: [], activeProfileId: null });

    fireEvent.click(screen.getByLabelText('LLM profile'));

    await screen.findByText('OpenHands - LLM Profiles');
    expect(screen.getByText('Create a new profile')).toBeInTheDocument();

    await waitFor(() => {
      expect(getLastPostedOfType('llmProfilesListRequest')).toBeTruthy();
    });
  });

  it('closes on selection and shows the selected profile when reopened', async () => {
    render(<App />);
    mockApi.postMessage.mockClear();

    postToWindow({ type: 'llmProfilesUpdated', profiles: ['gpt-5', 'claude_4'], activeProfileId: 'gpt-5' });

    fireEvent.click(screen.getByLabelText('LLM profile'));

    expect(await screen.findByLabelText('Edit selected profile gpt-5')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Select profile claude_4'));

    await waitFor(() => {
      expect(getLastPostedOfType('setLlmProfileId')).toBeTruthy();
    });

    const selection = getLastPostedOfType('setLlmProfileId');
    expect(selection.profileId).toBe('claude_4');



    // Simulate the host confirming the selection via llmProfilesUpdated.
    postToWindow({ type: 'llmProfilesUpdated', profiles: ['gpt-5', 'claude_4'], activeProfileId: 'claude_4' });

    await waitFor(() => {
      expect(screen.queryByLabelText('Edit selected profile gpt-5')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('LLM profile'));

    expect(await screen.findByLabelText('Edit selected profile claude_4')).toBeInTheDocument();
    expect(screen.queryByLabelText('Edit selected profile gpt-5')).not.toBeInTheDocument();
  });

  it('opens the Profiles view focused on the selected profile for editing', async () => {
    render(<App />);
    mockApi.postMessage.mockClear();

    postToWindow({ type: 'llmProfilesUpdated', profiles: ['gpt-5'], activeProfileId: 'gpt-5' });

    fireEvent.click(screen.getByLabelText('LLM profile'));
    fireEvent.click(await screen.findByLabelText('Edit selected profile gpt-5'));

    await screen.findByText('OpenHands - LLM Profiles');

    await waitFor(() => {
      expect(getLastPostedOfType('llmProfilesListRequest')).toBeTruthy();
      expect(getLastPostedOfType('llmProfileLoadRequest')).toBeTruthy();
    });

    const listRequest = getLastPostedOfType('llmProfilesListRequest');
    postToWindow({ type: 'llmProfilesListResponse', requestId: listRequest.requestId, ok: true, profiles: ['gpt-5'] });

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
    });

    expect(await screen.findByText('Edit profile')).toBeInTheDocument();
  });
});
