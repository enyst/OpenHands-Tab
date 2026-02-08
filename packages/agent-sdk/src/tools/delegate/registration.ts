import type { AgentContext } from '../../sdk/context';
import type { AgentHook } from '../../sdk/runtime/hooks';
import type { SecretRegistry } from '../../sdk/runtime/SecretRegistry';
import type { OpenHandsSettings } from '../../sdk/types/settings';
import type { ToolDefinition } from '../../sdk/types/tools';
import type { BaseWorkspace } from '../../workspace';

export type DelegateAgentFactoryContext = {
  id: string;
  settings: OpenHandsSettings;
  workspace: BaseWorkspace;
  secrets?: SecretRegistry;
};

export type DelegateAgentFactorySpec = {
  tools?: ToolDefinition<unknown, unknown>[];
  includeDefaultTools?: boolean | string[];
  agentContext?: AgentContext;
  hooks?: AgentHook | AgentHook[];
};

export type DelegateAgentFactoryFunc = (ctx: DelegateAgentFactoryContext) => DelegateAgentFactorySpec;

export type AgentFactory = {
  factoryFunc: DelegateAgentFactoryFunc;
  description: string;
};

const userFactories: Map<string, AgentFactory> = new Map();

const DEFAULT_FACTORY: AgentFactory = {
  // Default agent type: leave configuration to DelegateTool defaults.
  factoryFunc: () => ({}),
  description: 'Default general-purpose agent',
};

const normalizeAgentType = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function registerAgent(args: { name: string; factoryFunc: DelegateAgentFactoryFunc; description: string }): void {
  const name = normalizeAgentType(args.name);
  if (!name || name === 'default') {
    throw new Error(`Agent type '${name || '<empty>'}' is reserved`);
  }
  if (userFactories.has(name)) {
    throw new Error(`Agent '${name}' already registered`);
  }
  userFactories.set(name, { factoryFunc: args.factoryFunc, description: args.description });
}

export function getAgentFactory(name: string | null | undefined): AgentFactory {
  const normalized = normalizeAgentType(name);
  if (!normalized || normalized === 'default') return DEFAULT_FACTORY;

  const factory = userFactories.get(normalized);
  if (!factory) {
    const available = Array.from(userFactories.keys()).sort();
    const availableList = available.length ? available.join(', ') : 'none registered';
    throw new Error(
      `Unknown agent '${normalized}'. Available types: ${availableList}. Use registerAgent() to add custom agent types.`,
    );
  }
  return factory;
}

export function getFactoryInfo(): string {
  const lines: string[] = ['Available agent factories:'];
  lines.push('- **default**: Default general-purpose agent (used when no agent type is provided)');

  const entries = Array.from(userFactories.entries()).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) {
    lines.push('- No user-registered agents yet. Call registerAgent(...) to add custom agent types.');
    return lines.join('\n');
  }

  for (const [name, factory] of entries) {
    lines.push(`- **${name}**: ${factory.description}`);
  }
  return lines.join('\n');
}

export function _resetRegistryForTests(): void {
  userFactories.clear();
}

