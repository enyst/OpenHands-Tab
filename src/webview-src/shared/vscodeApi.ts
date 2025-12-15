export interface VscodeApi {
  postMessage: (message: unknown) => void;
  getState?: <T>() => T | undefined;
  setState?: <T>(state: T) => T;
}

type GlobalWithApi = typeof globalThis & {
  __OH_VSCODE_API__?: VscodeApi;
  acquireVsCodeApi?: () => VscodeApi;
};

let cachedApi: VscodeApi | null = null;
const noopPostMessage = (_message: unknown) => undefined;
const fallbackApi: VscodeApi = {
  postMessage: noopPostMessage,
  getState: () => undefined,
  setState: <T>(state: T) => state,
};

export function getVscodeApi(): VscodeApi {
  if (cachedApi) return cachedApi;

  if (typeof globalThis !== 'undefined') {
    const g = globalThis as GlobalWithApi;
    cachedApi = g.__OH_VSCODE_API__ ?? g.acquireVsCodeApi?.() ?? fallbackApi;
    try {
      g.__OH_VSCODE_API__ = cachedApi;
    } catch {
      // Ignore assignment errors in hardened environments
    }
    return cachedApi;
  }

  cachedApi = fallbackApi;
  return cachedApi;
}
