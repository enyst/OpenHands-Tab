import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createConfigurationChangeHandler, type CreateConfigurationChangeHandlerDeps } from '../createConfigurationChangeHandler';

// Mock vscode module
vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn(),
    })),
  },
}));

describe('createConfigurationChangeHandler', () => {
  let deps: CreateConfigurationChangeHandlerDeps;
  let handler: ReturnType<typeof createConfigurationChangeHandler>;

  beforeEach(() => {
    deps = {
      ensureConversationAndConnection: vi.fn().mockResolvedValue(undefined),
      getConversation: vi.fn().mockReturnValue(undefined),
      setConversation: vi.fn(),
      getConversationMode: vi.fn().mockReturnValue('local'),
      getTerminal: vi.fn().mockReturnValue(undefined),
      setTerminal: vi.fn(),
      getTerminalLogPty: vi.fn().mockReturnValue(undefined),
      setTerminalLogPty: vi.fn(),
      setConversationStoreRoot: vi.fn(),
      setOutputVerbosity: vi.fn(),
      setVerboseEventLogging: vi.fn(),
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      renderError: vi.fn((err) => String(err)),
    };
    handler = createConfigurationChangeHandler(deps);
  });

  describe('openhands.conversation.maxIterations', () => {
    it('calls ensureConversationAndConnection when maxIterations changes', async () => {
      const event = {
        affectsConfiguration: (section: string) => section === 'openhands.conversation.maxIterations',
      };

      await handler(event as any);

      expect(deps.ensureConversationAndConnection).toHaveBeenCalled();
    });

    it('logs appropriate message for local mode', async () => {
      deps.getConversationMode = vi.fn().mockReturnValue('local');
      handler = createConfigurationChangeHandler(deps);

      const event = {
        affectsConfiguration: (section: string) => section === 'openhands.conversation.maxIterations',
      };

      await handler(event as any);

      expect(deps.log.info).toHaveBeenCalledWith(expect.stringContaining('Max iterations setting updated'));
      expect(deps.log.info).toHaveBeenCalledWith(expect.stringContaining('local mode'));
    });

    it('logs appropriate message for remote mode', async () => {
      deps.getConversationMode = vi.fn().mockReturnValue('remote');
      handler = createConfigurationChangeHandler(deps);

      const event = {
        affectsConfiguration: (section: string) => section === 'openhands.conversation.maxIterations',
      };

      await handler(event as any);

      expect(deps.log.info).toHaveBeenCalledWith(expect.stringContaining('Max iterations setting updated'));
      expect(deps.log.info).toHaveBeenCalledWith(expect.stringContaining('remote mode'));
    });

    it('logs error when ensureConversationAndConnection fails', async () => {
      deps.ensureConversationAndConnection = vi.fn().mockRejectedValue(new Error('test error'));
      handler = createConfigurationChangeHandler(deps);

      const event = {
        affectsConfiguration: (section: string) => section === 'openhands.conversation.maxIterations',
      };

      await handler(event as any);

      expect(deps.log.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to apply max iterations update'));
    });
  });
});
