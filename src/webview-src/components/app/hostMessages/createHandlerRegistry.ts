import type { RefObject } from 'react';
import type { HostMessageHandlerOptions, HostMessageHandlerRegistry } from './types';
import { createConnectionHandlers } from './handlers/connectionHandlers';
import { createLlmProfileHandlers } from './handlers/llmProfileHandlers';
import { createHalHandlers } from './handlers/halHandlers';
import { createAppHandlers } from './handlers/appHandlers';
import { createE2eActionHandler } from './handlers/e2eActionHandler';

export function createHandlerRegistry(args: {
  options: HostMessageHandlerOptions;
  lastModeRef: RefObject<'local' | 'remote' | null>;
}): HostMessageHandlerRegistry {
  const { options, lastModeRef } = args;

  return {
    ...createConnectionHandlers({ options, lastModeRef }),
    ...createLlmProfileHandlers(options),
    ...createHalHandlers(options),
    ...createAppHandlers(options),
    e2eAction: createE2eActionHandler(options),
  };
}
