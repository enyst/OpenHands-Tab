import { useCallback, useState } from 'react';
import { normalizePastedImageLabel, readBlobAsDataUrl } from './pastedImages';
import type { ShowStatusMessage } from './useStatusMessages';

export type InlineImageAttachment = {
  id: string;
  label: string;
  dataUrl: string;
  sizeBytes: number;
};

export function useInlineImageAttachments({
  showStatusMessage,
  maxImages,
  maxBytesPerImage,
}: {
  showStatusMessage: ShowStatusMessage;
  maxImages: number;
  maxBytesPerImage: number;
}) {
  const [inlineImages, setInlineImages] = useState<InlineImageAttachment[]>([]);

  const handlePasteImageFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;

    const nextImages: InlineImageAttachment[] = [];
    let didSkipLarge = false;
    let didSkipSvg = false;
    const remainingSlots = Math.max(0, maxImages - inlineImages.length);
    if (remainingSlots === 0) {
      showStatusMessage('warn', `You can paste up to ${maxImages} images per message.`);
      return;
    }

    for (const file of files) {
      if (nextImages.length >= remainingSlots) break;
      if (!file.type.startsWith('image/')) continue;
      if (file.type === 'image/svg+xml') {
        didSkipSvg = true;
        continue;
      }
      if (file.size > maxBytesPerImage) {
        didSkipLarge = true;
        continue;
      }

      try {
        const dataUrl = await readBlobAsDataUrl(file);
        nextImages.push({
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          label: normalizePastedImageLabel(file),
          dataUrl,
          sizeBytes: file.size,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        showStatusMessage('error', `Failed to paste image: ${reason}`);
      }
    }

    if (didSkipLarge) {
      const mb = maxBytesPerImage / (1024 * 1024);
      const limitLabel = mb >= 1 ? `${mb.toFixed(1).replace(/\.0$/, '')}MB` : `${Math.trunc(maxBytesPerImage / 1024)}KB`;
      showStatusMessage('warn', `Some images were too large to paste (max ${limitLabel}).`);
    }
    if (didSkipSvg) {
      showStatusMessage('warn', 'SVG images are not supported for pasted images.');
    }

    if (nextImages.length === 0) return;
    setInlineImages((prev) => [...prev, ...nextImages].slice(0, maxImages));
  }, [inlineImages.length, maxBytesPerImage, maxImages, showStatusMessage]);

  const handleRemoveInlineImage = useCallback((id: string) => {
    setInlineImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  return { inlineImages, setInlineImages, handlePasteImageFiles, handleRemoveInlineImage };
}
