import type { LLMConfiguration } from '@openhands/agent-sdk-ts';
import type { LlmProfileApiKeyStatusInfo } from '../../../shared/webviewMessages';

export type PendingLlmProfilesRequest =
  | {
    kind: 'list';
    resolve: (profiles: string[]) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
  | {
    kind: 'load';
    resolve: (profile: LLMConfiguration) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
  | {
    kind: 'save';
    resolve: () => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
  | {
    kind: 'delete';
    resolve: () => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
  | {
    kind: 'apiKeyStatus';
    resolve: (status: LlmProfileApiKeyStatusInfo) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
  | {
    kind: 'apiKeySet';
    resolve: () => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  };

