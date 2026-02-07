export const getString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

export const getNumber = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);
