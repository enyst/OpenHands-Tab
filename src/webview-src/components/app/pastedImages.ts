export function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Failed to read image.'));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => {
      const error = reader.error ?? new Error('Failed to read image.');
      reject(error);
    };
    reader.readAsDataURL(blob);
  });
}

export function escapeMarkdownAltText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\]/g, '\\]').replace(/[\r\n]+/g, ' ').trim();
}

function mimeTypeToExtension(mimeType: string): string {
  const subtype = mimeType.split('/')[1] ?? '';
  if (subtype === 'jpeg') return 'jpg';
  if (subtype === 'svg+xml') return 'svg';
  if (subtype) return subtype;
  return 'png';
}

export function normalizePastedImageLabel(file: File): string {
  const name = typeof file.name === 'string' ? file.name.trim() : '';
  if (name) return name.replace(/[\r\n]+/g, ' ').trim();
  const ext = mimeTypeToExtension(file.type);
  return `pasted-image.${ext}`;
}

