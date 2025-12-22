export function normalizeTtsText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

