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
    const onDeleteConversation = vi.fn();

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
        onDeleteConversation={onDeleteConversation}
      />
    );

    act(() => { vi.advanceTimersByTime(150); });

    expect(screen.getByText('Fix sidebar issue')).toBeInTheDocument();
    expect(screen.getByText('Conversation (def45)')).toBeInTheDocument();

    const input = screen.getByLabelText('Search conversation history');
    fireEvent.change(input, { target: { value: 'fix' } });

    expect(screen.getByText('Fix sidebar issue')).toBeInTheDocument();
    expect(screen.queryByText('Conversation (def45)')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 1 match (2 total)')).toBeInTheDocument();
  });

  it('shows no-results state and clears search', () => {
    const onClose = vi.fn();
    const onSelectConversation = vi.fn();
    const onDeleteConversation = vi.fn();

    render(
      <HistoryView
        isOpen
        onClose={onClose}
        conversations={[
          { id: 'abc123', title: 'Fix sidebar issue', firstMessage: 'hey', timestamp: 2000 },
          { id: 'def456', firstMessage: 'Refactor prompt', timestamp: 1000 },
        ]}
        onSelectConversation={onSelectConversation}
        onDeleteConversation={onDeleteConversation}
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
    const onDeleteConversation = vi.fn();

    render(
      <HistoryView
        isOpen
        onClose={onClose}
        conversations={[{ id: 'abc123', title: 'Fix sidebar issue', firstMessage: 'hey', timestamp: 1000 }]}
        onSelectConversation={onSelectConversation}
        onDeleteConversation={onDeleteConversation}
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
    const onDeleteConversation = vi.fn();

    render(
      <HistoryView
        isOpen
        onClose={onClose}
        conversations={[{ id: 'abc123', title: 'Fix sidebar issue', firstMessage: 'hey', timestamp: 1000 }]}
        onSelectConversation={onSelectConversation}
        onDeleteConversation={onDeleteConversation}
      />
    );

    act(() => { vi.advanceTimersByTime(150); });

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('paginates conversations with Load more', () => {
    const onClose = vi.fn();
    const onSelectConversation = vi.fn();
    const onDeleteConversation = vi.fn();

    const conversations = Array.from({ length: 31 }, (_, idx) => {
      const n = idx + 1;
      return { id: `conv-${n}`, title: `Conversation ${n}`, timestamp: n };
    });

    render(
      <HistoryView
        isOpen
        onClose={onClose}
        conversations={conversations}
        onSelectConversation={onSelectConversation}
        onDeleteConversation={onDeleteConversation}
      />
    );

    act(() => { vi.advanceTimersByTime(150); });

    expect(screen.getByText('Showing 30 of 31 conversations')).toBeInTheDocument();
    expect(screen.queryByText('Conversation 1')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load more conversations' }));

    expect(screen.getByText('Conversation 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more conversations' })).not.toBeInTheDocument();
    expect(screen.getByText('31 conversations')).toBeInTheDocument();
  });

  it('calls onDeleteConversation when trash icon is clicked', () => {
    const onClose = vi.fn();
    const onSelectConversation = vi.fn();
    const onDeleteConversation = vi.fn();

    render(
      <HistoryView
        isOpen
        onClose={onClose}
        conversations={[
          { id: 'abc123', title: 'Fix sidebar issue', firstMessage: 'hey', timestamp: 2000 },
          { id: 'def456', firstMessage: 'Refactor prompt', timestamp: 1000 },
        ]}
        onSelectConversation={onSelectConversation}
        onDeleteConversation={onDeleteConversation}
      />
    );

    act(() => { vi.advanceTimersByTime(150); });

    const deletes = screen.getAllByRole('button', { name: 'Delete conversation' });
    fireEvent.click(deletes[0]!);

    expect(onDeleteConversation).toHaveBeenCalledTimes(1);
    expect(onDeleteConversation).toHaveBeenCalledWith('abc123');
  });
});
