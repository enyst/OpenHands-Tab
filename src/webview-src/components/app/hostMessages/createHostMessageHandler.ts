import type { RefObject } from 'react';
import { createHandlerRegistry } from './createHandlerRegistry';
import type { HostMessageHandlerOptions, HostMessagePayload } from './types';

export function createHostMessageHandler(args: {
  options: HostMessageHandlerOptions;
  lastModeRef: RefObject<'local' | 'remote' | null>;
}): (event: MessageEvent) => void {
  const handlers = createHandlerRegistry(args);

  return (event: MessageEvent) => {
    const payload = event.data as HostMessagePayload;
    if (!payload || typeof payload.type !== 'string') {
      return;
    }

    const handler = handlers[payload.type];
    if (!handler) {
      return;
    }

    handler(payload);
  };
}
