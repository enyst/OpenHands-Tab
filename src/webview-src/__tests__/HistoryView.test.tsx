import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { HistoryView } from '../components/HistoryView';

describe('HistoryView', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('filters conversations by search query', () => {
    const onClose = vi.fn();
    const onSelectConversation = vi.fn();

    render(
      <HistoryView
        isOpen
        onClose={onClose}
        conversations={[
          { id: 'abc123', title: 'Fix sidebar issue', firstMessage: 'hey', timestamp: 1000 },
          { id: 'def456', firstMessage: 'Refactor prompt', timestamp: 2000 },
        ]}
        currentConversationId="def456"
        onSelectConversation={onSelectConversation}
      />
    );

    act(() => { vi.advanceTimersByTime(150); });

    expect(screen.getByText('Fix sidebar issue')).toBeInTheDocument();
    expect(screen.getByText('Conversation (def45)')).toBeInTheDocument();

    const input = screen.getByLabelText('Search conversation history');
    fireEvent.change(input, { target: { value: 'fix' } });

    expect(screen.getByText('Fix sidebar issue')).toBeInTheDocument();
    expect(screen.queryByText('Conversation (def45)')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 2 conversations')).toBeInTheDocument();
  });

  it('shows no-results state and clears search', () => {
    const onClose = vi.fn();
    const onSelectConversation = vi.fn();

    render(
      <HistoryView
        isOpen
        onClose={onClose}
        conversations={[
          { id: 'abc123', title: 'Fix sidebar issue', firstMessage: 'hey', timestamp: 1000 },
          { id: 'def456', firstMessage: 'Refactor prompt', timestamp: 2000 },
        ]}
        onSelectConversation={onSelectConversation}
      />
    );

    act(() => { vi.advanceTimersByTime(150); });

    const input = screen.getByLabelText('Search conversation history');
    fireEvent.change(input, { target: { value: 'nope' } });

    expect(screen.getByText('No matches')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Clear search'));

    expect(screen.getByText('Fix sidebar issue')).toBeInTheDocument();
    expect(screen.getByText('Conversation (def45)')).toBeInTheDocument();
  });

  it('clears search on Escape without closing', () => {
    const onClose = vi.fn();
    const onSelectConversation = vi.fn();

    render(
      <HistoryView
        isOpen
        onClose={onClose}
        conversations={[{ id: 'abc123', title: 'Fix sidebar issue', firstMessage: 'hey', timestamp: 1000 }]}
        onSelectConversation={onSelectConversation}
      />
    );

    act(() => { vi.advanceTimersByTime(150); });

    const input = screen.getByLabelText('Search conversation history');
    fireEvent.change(input, { target: { value: 'fix' } });

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('closes on Escape when search is empty', () => {
    const onClose = vi.fn();
    const onSelectConversation = vi.fn();

    render(
      <HistoryView
        isOpen
        onClose={onClose}
        conversations={[{ id: 'abc123', title: 'Fix sidebar issue', firstMessage: 'hey', timestamp: 1000 }]}
        onSelectConversation={onSelectConversation}
      />
    );

    act(() => { vi.advanceTimersByTime(150); });

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
