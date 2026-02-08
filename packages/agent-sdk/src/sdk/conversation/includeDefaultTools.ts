export type IncludeDefaultToolsOption = boolean | string[] | undefined;

const toToolName = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const resolveDefaultToolSubset = <T extends { name: string }>(
  selection: readonly string[],
  defaults: readonly T[],
): T[] => {
  const allowed = new Set(defaults.map((tool) => tool.name));
  const uniqueNames = new Set<string>();
  for (const raw of selection) {
    const name = toToolName(raw);
    if (!name) continue;
    if (!allowed.has(name)) {
      throw new Error(
        `includeDefaultTools: unknown default tool '${name}'. Allowed: ${Array.from(allowed).sort().join(', ')}`,
      );
    }
    uniqueNames.add(name);
  }
  return defaults.filter((tool) => uniqueNames.has(tool.name));
};

const mergeTools = <T extends { name: string }>(defaults: readonly T[], provided: readonly T[]): T[] => {
  const byName = new Map<string, T>(defaults.map((tool) => [tool.name, tool]));
  for (const tool of provided) byName.set(tool.name, tool);

  const result: T[] = [];
  const included = new Set<string>();

  for (const tool of defaults) {
    result.push(byName.get(tool.name)!);
    included.add(tool.name);
  }

  for (const tool of provided) {
    if (included.has(tool.name)) continue;
    result.push(tool);
    included.add(tool.name);
  }

  return result;
};

export const resolveToolsWithDefaultTools = <T extends { name: string }>(params: {
  includeDefaultTools: IncludeDefaultToolsOption;
  /**
   * True if the caller explicitly passed a tools option (even if empty).
   * When true and includeDefaultTools is undefined, we preserve provided tools as-is.
   */
  hasToolsOption: boolean;
  defaultTools: readonly T[];
  providedTools: readonly T[] | undefined;
}): T[] => {
  const includeDefaultTools = params.includeDefaultTools;
  const provided = params.providedTools ?? [];
  const defaults = params.defaultTools;

  if (includeDefaultTools === undefined) {
    return params.hasToolsOption ? [...provided] : [...defaults];
  }

  if (includeDefaultTools === false) {
    return [...provided];
  }

  const selectedDefaults = Array.isArray(includeDefaultTools)
    ? resolveDefaultToolSubset(includeDefaultTools, defaults)
    : [...defaults];

  return mergeTools(selectedDefaults, provided);
};

