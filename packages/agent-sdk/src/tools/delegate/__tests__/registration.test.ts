import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetRegistryForTests, getAgentFactory, registerAgent } from '../registration';

describe('delegate registration', () => {
  beforeEach(() => _resetRegistryForTests());
  afterEach(() => _resetRegistryForTests());

  it('returns the default factory for empty or default type', () => {
    const defaultFactory = getAgentFactory(undefined);
    expect(defaultFactory.description).toContain('Default general-purpose agent');
    expect(getAgentFactory('default')).toBe(defaultFactory);
    expect(getAgentFactory('')).toBe(defaultFactory);
  });

  it('registers and retrieves a custom agent factory', () => {
    const dummyFactory = () => ({ includeDefaultTools: false });
    registerAgent({ name: 'custom_agent', factoryFunc: dummyFactory, description: 'Custom agent for testing' });
    const factory = getAgentFactory('custom_agent');
    expect(factory.description).toBe('Custom agent for testing');
    expect(factory.factoryFunc).toBe(dummyFactory);
  });

  it('throws a helpful error for unknown agent types', () => {
    expect(() => getAgentFactory('missing')).toThrow(/Unknown agent 'missing'/);
  });
});

