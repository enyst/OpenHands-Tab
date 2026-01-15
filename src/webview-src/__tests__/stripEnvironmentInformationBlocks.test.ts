import { describe, expect, it } from 'vitest';
import { stripEnvironmentInformationBlocks } from '../components/eventBlocks/shared';

describe('stripEnvironmentInformationBlocks', () => {
  it('strips a trailing legacy env-info block', () => {
    const text = [
      'hello',
      '',
      '<environment information>',
      'Active editor: README.md',
      '</environment information>',
      '',
    ].join('\n');

    expect(stripEnvironmentInformationBlocks(text)).toBe('hello');
  });

  it('does not strip an env-info block when it is not trailing', () => {
    const text = [
      'prefix',
      '<environment information>',
      'USER_INSERTED_ENV_BLOCK',
      '</environment information>',
      'suffix',
    ].join('\n');

    expect(stripEnvironmentInformationBlocks(text)).toBe(text);
  });
});
