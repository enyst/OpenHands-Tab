import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { App } from '../components/App';
import type { ActionEvent, ConversationStateUpdateEvent } from '@openhands/agent-sdk-ts';
import { postToWindow } from './testUtils';

describe('App - Confirmation Flow', () => {
  const mockApi = { postMessage: vi.fn() } as any;

  beforeEach(() => {
    // mock VS Code API
    // @ts-expect-error -- VS Code API is injected by host environment during runtime
    window.acquireVsCodeApi = () => mockApi;
    mockApi.postMessage.mockClear();
  });
  afterEach(() => { vi.useRealTimers(); cleanup(); });

  const mkAction = (over: Partial<ActionEvent> = {}): ActionEvent => ({
    kind: 'ActionEvent',
    source: 'agent',
    thought: [{ type: 'text', text: 'Consider running bash' }],
    action: { tool: 'terminal', args: { command: 'echo 1' } },
    tool_name: 'terminal',
    tool_call_id: 'call-1',
    tool_call: { id: 'call-1', type: 'function', function: { name: 'terminal', arguments: '{}' } },
    llm_response_id: 'resp-1',
    security_risk: 'HIGH',
    ...over,
  } as any);

  const setWaitingForConfirmation = () => {
    const state: ConversationStateUpdateEvent = { kind: 'ConversationStateUpdateEvent', agent_status: 'WAITING_FOR_CONFIRMATION' } as any;
    postToWindow({ type: 'event', event: state });
  };

  const renderAppAndWaitReady = async () => {
    const res = render(<App />);
    await waitFor(() => {
      expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'webviewReady' });
    });
    return res;
  };

  it('shows confirmation prompt for confirmable action and displays details', async () => {
    const res = await renderAppAndWaitReady();
    const q = within(res.baseElement);
    setWaitingForConfirmation();
    postToWindow({ type: 'event', event: mkAction() });

    const prompt = await q.findByText(/Confirmation Required/);
    expect(prompt).toBeInTheDocument();
    // Find the dialog container (the modal)
    const dialog = prompt.closest('[role="dialog"]') as HTMLElement;
    expect(dialog).toBeInTheDocument();
    const scope = within(dialog);
    // Tool name is shown in the action details
    expect(scope.getAllByText(/terminal/i).length).toBeGreaterThanOrEqual(1);
    const riskBadge = scope.getByText(/high risk/);
    expect(riskBadge).toBeInTheDocument();
    expect(riskBadge.className).toContain('bg-red-500/15');
    expect(scope.getByText(/Reasoning/)).toBeInTheDocument();
  });

  it('renders file access summary and opens the requested path', async () => {
    await renderAppAndWaitReady();
    setWaitingForConfirmation();

    const requestedPath = '/tmp/outside.txt';
    postToWindow({
      type: 'event',
      event: mkAction({
        tool_name: 'file_editor',
        action: { command: 'view', path: requestedPath },
        security_risk: undefined,
      }),
    });

    expect(await screen.findByText(/File Access/i)).toBeInTheDocument();
    expect(screen.getByText('READ')).toBeInTheDocument();
    const pathButton = screen.getByRole('button', { name: requestedPath });
    await userEvent.click(pathButton);
    expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'openWorkspaceFile', path: requestedPath });
  });

  it('hides prompt when no actions are pending', async () => {
    await renderAppAndWaitReady();
    setWaitingForConfirmation();
    // no action posted -> prompt should not render
    await waitFor(() => {
      expect(screen.queryByText(/Confirmation Required/)).not.toBeInTheDocument();
    });
  });

  it('does not show prompt if not waiting for confirmation even with pending action', async () => {
    await renderAppAndWaitReady();
    // Post action without setting WAITING_FOR_CONFIRMATION
    postToWindow({ type: 'event', event: mkAction() });
    await waitFor(() => {
      expect(screen.queryByText(/Confirmation Required/)).not.toBeInTheDocument();
    });
  });

  it('Approve sends command approveAction and disables button while submitting', async () => {
    await renderAppAndWaitReady();
    setWaitingForConfirmation();
    postToWindow({ type: 'event', event: mkAction() });

    const approveBtn = await screen.findByRole('button', { name: /approve/i });
    await userEvent.click(approveBtn);
    expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'command', command: 'approveAction' });
    // while submitting, buttons are disabled
    expect(approveBtn).toBeDisabled();
  });

  it('prevents double-submit for approve', async () => {
    await renderAppAndWaitReady();
    setWaitingForConfirmation();
    postToWindow({ type: 'event', event: mkAction({ tool_call_id: 'call-dbl' }) });
    const approveBtn = await screen.findByRole('button', { name: /approve/i });
    await userEvent.click(approveBtn);
    await userEvent.click(approveBtn);
    // only first click should dispatch
    const approveCalls = mockApi.postMessage.mock.calls.filter((c: any[]) => c[0]?.command === 'approveAction');
    expect(approveCalls.length).toBe(1);
  });

  it('Reject toggles input and sends command with reason', async () => {
    await renderAppAndWaitReady();
    setWaitingForConfirmation();
    postToWindow({ type: 'event', event: mkAction() });

    const rejectBtn = (await screen.findAllByRole('button', { name: /reject/i }))[0];
    await userEvent.click(rejectBtn);
    const input = await screen.findByPlaceholderText(/Reason for rejection \(optional\)/);
    await userEvent.type(input, 'Too risky');
    const confirmReject = await screen.findByRole('button', { name: /confirm rejection/i });
    await userEvent.click(confirmReject);
    expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'command', command: 'rejectAction', reason: 'Too risky' });
  });

  it('prevents double-submit for reject', async () => {
    await renderAppAndWaitReady();
    setWaitingForConfirmation();
    postToWindow({ type: 'event', event: mkAction({ tool_call_id: 'call-dbl-rej' }) });

    const rejectBtn = (await screen.findAllByRole('button', { name: /reject/i }))[0];
    await userEvent.click(rejectBtn);
    const confirmReject = await screen.findByRole('button', { name: /confirm rejection/i });
    await userEvent.click(confirmReject);
    await userEvent.click(confirmReject);

    const rejectCalls = mockApi.postMessage.mock.calls.filter((c: any[]) => c[0]?.command === 'rejectAction');
    expect(rejectCalls.length).toBe(1);
  });

  it('clears pending action after approval when ObservationEvent arrives', async () => {
    await renderAppAndWaitReady();
    setWaitingForConfirmation();
    postToWindow({ type: 'event', event: mkAction({ tool_call_id: 'call-clear' }) });
    const approveBtn = await screen.findByRole('button', { name: /approve/i });
    await userEvent.click(approveBtn);

    // send observation for that tool_call_id; should clear prompt
    postToWindow({ type: 'event', event: { kind: 'ObservationEvent', source: 'environment', observation: { ok: true }, tool_name: 'terminal', tool_call_id: 'call-clear', action_id: 'a1' } });
    await waitFor(() => {
      expect(screen.queryByText(/Confirmation Required/)).not.toBeInTheDocument();
    });
  });

  it('clears pending action after rejection when UserRejectObservation arrives', async () => {
    await renderAppAndWaitReady();
    setWaitingForConfirmation();
    postToWindow({ type: 'event', event: mkAction({ tool_call_id: 'call-rej' }) });
    const rejectBtn = await screen.findByRole('button', { name: /reject/i });
    await userEvent.click(rejectBtn);
    const confirmReject = await screen.findByRole('button', { name: /confirm rejection/i });
    await userEvent.click(confirmReject);

    postToWindow({ type: 'event', event: { kind: 'UserRejectObservation', source: 'environment', rejection_reason: 'no', tool_name: 'terminal', tool_call_id: 'call-rej', action_id: 'a2' } });
    await waitFor(() => {
      expect(screen.queryByText(/Confirmation Required/)).not.toBeInTheDocument();
    });
  });

  it('does not carry stale pending actions across confirmation sessions', async () => {
    await renderAppAndWaitReady();

    // First confirmation session
    setWaitingForConfirmation();
    postToWindow({
      type: 'event',
      event: mkAction({
        tool_call_id: 'call-old',
        llm_response_id: 'resp-same',
        thought: [{ type: 'text', text: 'Old pending action' }],
      }),
    });

    const firstDialog = await screen.findByRole('dialog');
    expect(within(firstDialog).getByText('Old pending action')).toBeInTheDocument();

    // Simulate agent moving on (approve accepted, status no longer waiting)
    postToWindow({
      type: 'event',
      event: { kind: 'ConversationStateUpdateEvent', agent_status: 'RUNNING' } as ConversationStateUpdateEvent,
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // Second confirmation session (same llm_response_id to ensure we truly cleared)
    setWaitingForConfirmation();
    postToWindow({
      type: 'event',
      event: mkAction({
        tool_call_id: 'call-new',
        llm_response_id: 'resp-same',
        thought: [{ type: 'text', text: 'New pending action' }],
      }),
    });

    const secondDialog = await screen.findByRole('dialog');
    const scope = within(secondDialog);
    expect(scope.getByText('New pending action')).toBeInTheDocument();
    expect(scope.queryByText('Old pending action')).not.toBeInTheDocument();
  });

  it('replaces pending actions when a new action batch arrives', async () => {
    await renderAppAndWaitReady();
    setWaitingForConfirmation();

    postToWindow({
      type: 'event',
      event: mkAction({
        tool_call_id: 'call-old-batch',
        llm_response_id: 'resp-old-batch',
        thought: [{ type: 'text', text: 'Old batch action' }],
      }),
    });

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Old batch action')).toBeInTheDocument();

    // New action from a new LLM response should replace (not append)
    postToWindow({
      type: 'event',
      event: mkAction({
        tool_call_id: 'call-new-batch',
        llm_response_id: 'resp-new-batch',
        thought: [{ type: 'text', text: 'New batch action' }],
      }),
    });

    await waitFor(() => {
      const updatedDialog = screen.getByRole('dialog');
      const scope = within(updatedDialog);
      expect(scope.getByText('New batch action')).toBeInTheDocument();
      expect(scope.queryByText('Old batch action')).not.toBeInTheDocument();
    });
  });

  it('sets isSubmitting=true when approval sent, and resets after 30s timeout', async () => {
    await renderAppAndWaitReady();
    // Spy on setTimeout so we can trigger the scheduled reset callback without relying on fake timers
    const stSpy = vi.spyOn(global, 'setTimeout');
    setWaitingForConfirmation();
    postToWindow({ type: 'event', event: mkAction({ tool_call_id: 'call-timeout' }) });

    const approveBtn = (await screen.findByRole('button', { name: /approve/i }));
    await userEvent.click(approveBtn);
    expect(approveBtn).toBeDisabled();

    // Ensure a 30s timeout was scheduled and manually invoke its callback
    const idx = stSpy.mock.calls.findIndex((c: any[]) => c[1] === 30000);
    expect(idx).toBeGreaterThan(-1);
    const cb = stSpy.mock.calls[idx][0] as Function;
    await act(async () => { (cb as any)(); });
    stSpy.mockRestore();

    const approveBtnAfter = screen.getAllByRole('button', { name: /approve/i })[0];
    expect(approveBtnAfter).not.toBeDisabled();
  });

  it('clears pending action and confirmation prompt on AgentErrorEvent', async () => {
    await renderAppAndWaitReady();
    setWaitingForConfirmation();
    postToWindow({ type: 'event', event: mkAction({ tool_call_id: 'call-err' }) });

    const approveBtn = await screen.findByRole('button', { name: /approve/i });
    await userEvent.click(approveBtn);
    expect(approveBtn).toBeDisabled();

    // AgentErrorEvent clears the matching pending action (like ObservationEvent)
    postToWindow({ type: 'event', event: { kind: 'AgentErrorEvent', source: 'agent', error: 'oops', tool_name: 'terminal', tool_call_id: 'call-err' } });
    await waitFor(() => {
      expect(screen.queryByText(/Confirmation Required/)).not.toBeInTheDocument();
    });
  });

  it('renders action JSON details in prompt', async () => {
    const res = await renderAppAndWaitReady();
    const q = within(res.baseElement);
    setWaitingForConfirmation();
    postToWindow({ type: 'event', event: mkAction() });
    expect(await q.findByText(/View details/)).toBeInTheDocument();
    // Use getAllBy to avoid ambiguity (tool name appears in multiple places)
    expect(q.getAllByText(/terminal/i).length).toBeGreaterThan(0);
  });
});
