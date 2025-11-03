
// Mock vscode module for testing
const mockFn = () => {
  const fn: any = () => {};
  fn.mockReturnValue = (value: any) => {
    fn.mockReturnValueOnce = () => value;
    return fn;
  };
  fn.mockReturnValueOnce = (value: any) => value;
  fn.mockResolvedValue = (value: any) => Promise.resolve(value);
  fn.mockImplementation = (impl: any) => impl;
  return fn;
};

export const workspace = {
  getConfiguration: mockFn(),
};

export const ConfigurationTarget = {
  Workspace: 2,
  Global: 1,
};

export default {
  workspace,
  ConfigurationTarget,
};
