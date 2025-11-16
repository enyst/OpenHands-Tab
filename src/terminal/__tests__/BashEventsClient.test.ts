import { describe, it, expect } from 'vitest';
import {
  isBashEvent,
  isBashCommand,
  isBashOutput,
  isBashExit,
  type BashCommand,
  type BashOutput,
  type BashExit,
} from 'agent-sdk-ts';

describe('BashEventsClient type guards', () => {
  it('validates BashCommand event', () => {
    const event: BashCommand = {
      type: 'BashCommand',
      id: 'cmd-1',
      timestamp: '2025-01-26T12:00:00Z',
      command_id: 'uuid-1',
      order: 0,
      command: 'ls -la',
    };
    expect(isBashEvent(event)).toBe(true);
    expect(isBashCommand(event)).toBe(true);
    expect(isBashOutput(event)).toBe(false);
    expect(isBashExit(event)).toBe(false);
  });

  it('validates BashOutput event', () => {
    const event: BashOutput = {
      type: 'BashOutput',
      id: 'out-1',
      timestamp: '2025-01-26T12:00:01Z',
      command_id: 'uuid-1',
      order: 1,
      exit_code: null,
      stdout: 'file1.txt\nfile2.txt\n',
      stderr: null,
    };
    expect(isBashEvent(event)).toBe(true);
    expect(isBashOutput(event)).toBe(true);
    expect(isBashCommand(event)).toBe(false);
    expect(isBashExit(event)).toBe(false);
  });

  it('validates BashExit event', () => {
    const event: BashExit = {
      type: 'BashExit',
      id: 'exit-1',
      timestamp: '2025-01-26T12:00:02Z',
      command_id: 'uuid-1',
      order: 2,
      exit_code: 0,
    };
    expect(isBashEvent(event)).toBe(true);
    expect(isBashExit(event)).toBe(true);
    expect(isBashCommand(event)).toBe(false);
    expect(isBashOutput(event)).toBe(false);
  });

  it('rejects invalid bash event structures', () => {
    expect(isBashEvent(null as any)).toBe(false);
    expect(isBashEvent({} as any)).toBe(false);
    expect(isBashEvent({ type: 'BashCommand' } as any)).toBe(false);
    expect(isBashEvent({ type: 'BashCommand', command_id: 'uuid' } as any)).toBe(false);
    expect(isBashEvent({ type: 'UnknownType', command_id: 'uuid', order: 0 } as any)).toBe(false);
  });

  it('validates BashOutput with stderr', () => {
    const event: BashOutput = {
      type: 'BashOutput',
      id: 'out-2',
      timestamp: '2025-01-26T12:00:03Z',
      command_id: 'uuid-2',
      order: 0,
      exit_code: null,
      stdout: null,
      stderr: 'Error: file not found\n',
    };
    expect(isBashEvent(event)).toBe(true);
    expect(isBashOutput(event)).toBe(true);
  });
});

describe('BashEventsClient', () => {
  it('initializes with correct status', async () => {
    const { BashEventsClient } = await import('../BashEventsClient');
    let status: 'online' | 'offline' | 'connecting' = 'offline';

    const client = new BashEventsClient(
      'http://localhost:3000',
      {
        onEvent: () => {},
        onError: () => {},
        onStatus: (s) => { status = s; },
      }
    );

    expect(client.getStatus()).toBe('offline');
    expect(status).toBe('offline');
  });

  it('updates server URL', async () => {
    const { BashEventsClient } = await import('../BashEventsClient');
    const client = new BashEventsClient(
      'http://localhost:3000',
      { onEvent: () => {}, onError: () => {}, onStatus: () => {} }
    );

    client.setServerUrl('http://localhost:4000');
    // No direct getter for serverUrl, but we can verify no errors
    expect(client.getStatus()).toBe('offline');
  });
});
