export function normalizeNonEmptyString(value: string | null | undefined): string | undefined {
  return value?.trim() || undefined;
}
