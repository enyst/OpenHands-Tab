import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { App } from '../components/App';
import type { MessageEvent as AgentMessageEvent } from '@openhands/agent-sdk-ts';
import { postToWindow } from './testUtils';

afterEach(() => {
  cleanup();
});

describe('Attachment marker parsing', () => {
  it('does not treat end-marker substrings inside content as end markers', async () => {
    render(<App />);

    const text = [
      'Intro line',
      '',
      '----- BEGIN ATTACHMENT: file.txt -----',
      'line1',
      'some text ----- END ATTACHMENT: file.txt ----- in middle',
      'line3',
      '----- END ATTACHMENT: file.txt -----',
      '',
      'Outro line',
    ].join('\n');

    const ev: AgentMessageEvent = {
      kind: 'MessageEvent',
      source: 'user',
      llm_message: {
        role: 'user',
        content: [{ type: 'text', text }],
      },
    } as any;

    postToWindow({ type: 'event', event: ev });

    expect(await screen.findByText(/Intro line/)).toBeInTheDocument();
    expect(await screen.findByText(/Outro line/)).toBeInTheDocument();
    expect(screen.queryByText(/BEGIN ATTACHMENT/)).toBeNull();

    const label = await screen.findByText('file.txt');
    const details = label.closest('details');
    expect(details).not.toBeNull();
    if (!details) return;

    fireEvent.click(label);
    expect(within(details).getByText(/line1/)).toBeInTheDocument();
    expect(within(details).getByText(/in middle/)).toBeInTheDocument();
    expect(within(details).getByText(/line3/)).toBeInTheDocument();
  });

  it('accepts markers with more than five dashes', async () => {
    render(<App />);

    const text = [
      'Dash test',
      '',
      '---------- BEGIN ATTACHMENT: dash.txt ----------',
      'payload',
      '---------- END ATTACHMENT: dash.txt ----------',
      '',
      'Done',
    ].join('\n');

    const ev: AgentMessageEvent = {
      kind: 'MessageEvent',
      source: 'user',
      llm_message: {
        role: 'user',
        content: [{ type: 'text', text }],
      },
    } as any;

    postToWindow({ type: 'event', event: ev });

    expect(await screen.findByText(/Dash test/)).toBeInTheDocument();
    expect(await screen.findByText(/Done/)).toBeInTheDocument();
    expect(screen.queryByText(/BEGIN ATTACHMENT/)).toBeNull();

    const label = await screen.findByText('dash.txt');
    const details = label.closest('details');
    expect(details).not.toBeNull();
    if (!details) return;

    fireEvent.click(label);
    expect(within(details).getByText(/payload/)).toBeInTheDocument();
  });

  it('keeps scanning after an unmatched BEGIN marker', async () => {
    render(<App />);

    const text = [
      'Intro',
      '',
      '----- BEGIN ATTACHMENT: missing.txt -----',
      'this never closes',
      '',
      '----- BEGIN ATTACHMENT: ok.txt -----',
      'OK',
      '----- END ATTACHMENT: ok.txt -----',
      '',
      'Outro',
    ].join('\n');

    const ev: AgentMessageEvent = {
      kind: 'MessageEvent',
      source: 'user',
      llm_message: {
        role: 'user',
        content: [{ type: 'text', text }],
      },
    } as any;

    postToWindow({ type: 'event', event: ev });

    expect(await screen.findByText(/Intro/)).toBeInTheDocument();
    expect(await screen.findByText(/Outro/)).toBeInTheDocument();
    expect(screen.queryByText('missing.txt')).toBeNull();

    const label = await screen.findByText('ok.txt');
    const details = label.closest('details');
    expect(details).not.toBeNull();
    if (!details) return;

    fireEvent.click(label);
    expect(within(details).getByText('OK')).toBeInTheDocument();
  });

  it('parses multiple attachment blocks', async () => {
    render(<App />);

    const text = [
      'Hello',
      '',
      '----- BEGIN ATTACHMENT: a.txt -----',
      'A1',
      '----- END ATTACHMENT: a.txt -----',
      '',
      'Between',
      '',
      '----- BEGIN ATTACHMENT: b.txt -----',
      'B1',
      '----- END ATTACHMENT: b.txt -----',
      '',
      'Bye',
    ].join('\n');

    const ev: AgentMessageEvent = {
      kind: 'MessageEvent',
      source: 'user',
      llm_message: {
        role: 'user',
        content: [{ type: 'text', text }],
      },
    } as any;

    postToWindow({ type: 'event', event: ev });

    expect(await screen.findByText(/Hello/)).toBeInTheDocument();
    expect(await screen.findByText(/Between/)).toBeInTheDocument();
    expect(await screen.findByText(/Bye/)).toBeInTheDocument();

    const aLabel = await screen.findByText('a.txt');
    const aDetails = aLabel.closest('details');
    expect(aDetails).not.toBeNull();
    if (!aDetails) return;
    fireEvent.click(aLabel);
    expect(within(aDetails).getByText('A1')).toBeInTheDocument();

    const bLabel = await screen.findByText('b.txt');
    const bDetails = bLabel.closest('details');
    expect(bDetails).not.toBeNull();
    if (!bDetails) return;
    fireEvent.click(bLabel);
    expect(within(bDetails).getByText('B1')).toBeInTheDocument();
  });
});
