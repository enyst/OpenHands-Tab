export const mergeHeaders = (base?: Record<string, string>, overrides?: Record<string, string>): Record<string, string> => ({
  ...(base ?? {}),
  ...(overrides ?? {}),
});

export const buildOpenAiHeaders = (params: {
  apiKey: string;
  provider?: string;
  headers?: Record<string, string>;
}): Record<string, string> => {
  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${params.apiKey}`,
  };

  if (params.provider === 'openrouter') {
    baseHeaders['HTTP-Referer'] = 'https://openhands.io';
    baseHeaders['X-Title'] = 'OpenHands';
  }

  return mergeHeaders(baseHeaders, params.headers);
};
