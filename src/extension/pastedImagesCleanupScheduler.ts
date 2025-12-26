import type { Event } from '@openhands/agent-sdk-ts';
import type { BufferedConversationEvent } from '../conversation/eventBacklog';
import { OPENHANDS_IMAGE_URL_PREFIX, isValidPastedImageId } from '../shared/pastedImages';
import { cleanupPastedImages } from '../shared/pastedImagesCleanup';

type SchedulerParams = {
  iterBacklog: () => Iterable<BufferedConversationEvent>;
  getBaseDir: () => string;
  maxFiles: number;
  maxBytes: number;
  log: (line: string) => void;
  renderError: (err: unknown) => string;
};

const OPENHANDS_IMAGE_ID_REGEX = new RegExp(`${OPENHANDS_IMAGE_URL_PREFIX}([a-f0-9]{16}\\.[a-z0-9]+)`, 'g');

function messageHasPastedImages(event: Event): boolean {
  if (event.kind !== 'MessageEvent') return false;
  const content = (event as unknown as { llm_message?: { content?: unknown } }).llm_message?.content;
  if (!Array.isArray(content)) return false;
  for (const item of content) {
    if (!item || (item as { type?: unknown }).type !== 'text') continue;
    const text = (item as { text?: unknown }).text;
    if (typeof text === 'string' && text.includes(OPENHANDS_IMAGE_URL_PREFIX)) return true;
  }
  return false;
}

function collectReferencedPastedImageIdsFromBacklog(iterBacklog: SchedulerParams['iterBacklog']): Set<string> {
  const imageIds = new Set<string>();
  for (const item of iterBacklog()) {
    const event = item.event;
    if (event.kind !== 'MessageEvent') continue;
    const content = (event as unknown as { llm_message?: { content?: unknown } }).llm_message?.content;
    if (!Array.isArray(content)) continue;

    for (const part of content) {
      if (!part || (part as { type?: unknown }).type !== 'text') continue;
      const text = (part as { text?: unknown }).text;
      if (typeof text !== 'string' || !text.includes(OPENHANDS_IMAGE_URL_PREFIX)) continue;

      for (const match of text.matchAll(OPENHANDS_IMAGE_ID_REGEX)) {
        const imageId = match[1];
        if (typeof imageId === 'string' && isValidPastedImageId(imageId)) {
          imageIds.add(imageId);
        }
      }
    }
  }
  return imageIds;
}

export function createPastedImagesCleanupScheduler(params: SchedulerParams) {
  let cleanupInFlight: Promise<void> | undefined;
  let cleanupQueued = false;

  const schedule = (): void => {
    if (cleanupInFlight) {
      cleanupQueued = true;
      return;
    }

    cleanupInFlight = (async () => {
      try {
        const keepImageIds = collectReferencedPastedImageIdsFromBacklog(params.iterBacklog);
        await cleanupPastedImages({
          baseDir: params.getBaseDir(),
          keepImageIds,
          maxFiles: params.maxFiles,
          maxBytes: params.maxBytes,
          log: params.log,
        });
      } catch (err) {
        params.log(`[pasted-images] Cleanup failed: ${params.renderError(err)}`);
      } finally {
        cleanupInFlight = undefined;
      }
    })().finally(() => {
      if (cleanupQueued) {
        cleanupQueued = false;
        schedule();
      }
    });
  };

  const handleBufferedEvent = (event: Event): void => {
    if (!messageHasPastedImages(event)) return;
    schedule();
  };

  return { handleBufferedEvent };
}

