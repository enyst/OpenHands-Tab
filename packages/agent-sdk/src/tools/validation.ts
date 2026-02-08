export const requireObject = (value: unknown, name: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object') {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
};

export const requireString = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
};

export const optionalString = (value: unknown, name: string): string | undefined => {
  if (value === undefined) return undefined;
  return requireString(value, name);
};

export const requireBoolean = (value: unknown, name: string): boolean => {
  if (typeof value !== 'boolean') {
    throw new Error(`${name} must be a boolean`);
  }
  return value;
};

export const optionalNumber = (value: unknown, name: string): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`${name} must be a number`);
  }
  return value;
};
