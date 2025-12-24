import { useEffect } from 'react';
import type { RefObject } from 'react';

export type CloseReason = 'escape' | 'outside';

export function useCloseOnEscapeAndOutsideClick(
  opts: { isOpen: boolean; onClose: (reason: CloseReason) => void; ref: RefObject<HTMLElement | null>; delay?: number }
) {
  const { isOpen, onClose, ref, delay = 100 } = opts;

  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose('escape');
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      const el = ref.current;
      if (el && !el.contains(e.target as Node)) {
        onClose('outside');
      }
    };

    const timer = window.setTimeout(() => {
      document.addEventListener('keydown', handleEscape);
      document.addEventListener('click', handleClickOutside);
    }, delay);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [isOpen, onClose, ref, delay]);
}
