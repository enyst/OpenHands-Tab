import { getVscodeApi } from '../../shared/vscodeApi';
import type { WebviewToHostMessage } from '../../../shared/webviewMessages';

const postMessage = (message: WebviewToHostMessage) => {
  const api = getVscodeApi();
  api.postMessage(message);
};

export const openWorkspaceFile = (path: string) => {
  postMessage({ type: 'openWorkspaceFile', path });
};

export const openWorkspaceDiff = (path: string, oldContent: string, newContent: string, options?: { preferGitHead?: boolean }) => {
  postMessage({
    type: 'openWorkspaceDiff',
    path,
    oldContent,
    newContent,
    ...(options?.preferGitHead ? { preferGitHead: true } : {}),
  });
};

export const openMarkdownLink = (href: string) => {
  postMessage({ type: 'openMarkdownLink', href });
};
