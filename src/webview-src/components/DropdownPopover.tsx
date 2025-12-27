import { useCallback, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useCloseOnEscapeAndOutsideClick, type CloseReason } from './useCloseOnEscapeAndOutsideClick';

export type DropdownPopoverPlacement = 'up' | 'down';

export function DropdownPopover({
  isOpen,
  onClose,
  triggerRef,
  preferPlacement = 'up',
  children,
  className = '',
}: {
  isOpen: boolean;
  onClose: (reason: CloseReason) => void;
  triggerRef: RefObject<HTMLElement | null>;
  preferPlacement?: DropdownPopoverPlacement;
  children: ReactNode;
  className?: string;
}) {
  const [placement, setPlacement] = useState<DropdownPopoverPlacement>(preferPlacement);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useCloseOnEscapeAndOutsideClick({ isOpen, onClose, ref: popoverRef, delay: 100 });

  const setPopoverNode = useCallback((node: HTMLDivElement | null) => {
    popoverRef.current = node;
    if (!node) {
      setPlacement(preferPlacement);
      return;
    }
    if (!isOpen) return;

    const triggerEl = triggerRef.current;
    if (!triggerEl) return;

    const trigger = triggerEl.getBoundingClientRect();
    const popover = node.getBoundingClientRect();
    const padding = 8;

    const spaceAbove = trigger.top;
    const spaceBelow = window.innerHeight - trigger.bottom;
    const needed = popover.height + padding;

    const canUp = spaceAbove >= needed;
    const canDown = spaceBelow >= needed;

    const next =
      preferPlacement === 'up'
        ? canUp
          ? 'up'
          : canDown
            ? 'down'
            : 'up'
        : canDown
          ? 'down'
          : canUp
            ? 'up'
            : 'down';

    setPlacement((prev) => (prev === next ? prev : next));
  }, [isOpen, preferPlacement, triggerRef]);

  if (!isOpen) return null;

  const positionClass = placement === 'up' ? 'bottom-full left-0 mb-2' : 'top-full left-0 mt-2';

  return (
    <div ref={setPopoverNode} className={`absolute ${positionClass} ${className}`}>
      {children}
    </div>
  );
}
