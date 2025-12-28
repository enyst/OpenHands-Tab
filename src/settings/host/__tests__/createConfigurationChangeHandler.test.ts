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
      setVerboseEventLogging: vi.fn(),
      getOutputChannel: vi.fn().mockReturnValue({ appendLine: vi.fn() }),
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
      const appendLine = vi.fn();
      deps.getOutputChannel = vi.fn().mockReturnValue({ appendLine });
      deps.getConversationMode = vi.fn().mockReturnValue('local');
      handler = createConfigurationChangeHandler(deps);

      const event = {
        affectsConfiguration: (section: string) => section === 'openhands.conversation.maxIterations',
      };

      await handler(event as any);

      expect(appendLine).toHaveBeenCalledWith(expect.stringContaining('Max iterations setting updated'));
      expect(appendLine).toHaveBeenCalledWith(expect.stringContaining('local mode'));
    });

    it('logs appropriate message for remote mode', async () => {
      const appendLine = vi.fn();
      deps.getOutputChannel = vi.fn().mockReturnValue({ appendLine });
      deps.getConversationMode = vi.fn().mockReturnValue('remote');
      handler = createConfigurationChangeHandler(deps);

      const event = {
        affectsConfiguration: (section: string) => section === 'openhands.conversation.maxIterations',
      };

      await handler(event as any);

      expect(appendLine).toHaveBeenCalledWith(expect.stringContaining('Max iterations setting updated'));
      expect(appendLine).toHaveBeenCalledWith(expect.stringContaining('remote mode'));
    });

    it('logs error when ensureConversationAndConnection fails', async () => {
      const appendLine = vi.fn();
      deps.getOutputChannel = vi.fn().mockReturnValue({ appendLine });
      deps.ensureConversationAndConnection = vi.fn().mockRejectedValue(new Error('test error'));
      handler = createConfigurationChangeHandler(deps);

      const event = {
        affectsConfiguration: (section: string) => section === 'openhands.conversation.maxIterations',
      };

      await handler(event as any);

      expect(appendLine).toHaveBeenCalledWith(expect.stringContaining('Failed to apply max iterations update'));
    });
  });
});
