import { useState, useRef, useCallback, type ReactNode, useEffect } from 'react';

type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  position?: TooltipPosition;
  delay?: number;
  className?: string;
}

/**
 * Styled tooltip component matching OpenHands "Warm Technical Refinement" design.
 * Features glass morphism, warm amber accents, and smooth animations.
 */
export function Tooltip({
  content,
  children,
  position = 'top',
  delay = 400,
  className = '',
}: TooltipProps) {
  const [isMounted, setIsMounted] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [actualPosition, setActualPosition] = useState(position);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  const setTooltipNode = useCallback((node: HTMLDivElement | null) => {
    tooltipRef.current = node;
    if (!node) return;
    if (!triggerRef.current) {
      setIsVisible(true);
      return;
    }

    const tooltip = node.getBoundingClientRect();
    const trigger = triggerRef.current.getBoundingClientRect();
    const padding = 8;

    let nextPosition = position;

    if (position === 'top' && trigger.top - tooltip.height - padding < 0) {
      nextPosition = 'bottom';
    } else if (position === 'bottom' && trigger.bottom + tooltip.height + padding > window.innerHeight) {
      nextPosition = 'top';
    } else if (position === 'left' && trigger.left - tooltip.width - padding < 0) {
      nextPosition = 'right';
    } else if (position === 'right' && trigger.right + tooltip.width + padding > window.innerWidth) {
      nextPosition = 'left';
    }

    setActualPosition((prev) => (prev === nextPosition ? prev : nextPosition));
    setIsVisible(true);
  }, [position]);

  const showTooltip = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setActualPosition(position);
      setIsMounted(true);
      setIsVisible(false);
    }, delay);
  }, [delay, position]);

  const hideTooltip = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsVisible(false);
    setIsMounted(false);
    setActualPosition(position);
  }, [position]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const positionClasses: Record<TooltipPosition, string> = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  const arrowClasses: Record<TooltipPosition, string> = {
    top: 'top-full left-1/2 -translate-x-1/2 border-t-[var(--surface-2)] border-x-transparent border-b-transparent',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 border-b-[var(--surface-2)] border-x-transparent border-t-transparent',
    left: 'left-full top-1/2 -translate-y-1/2 border-l-[var(--surface-2)] border-y-transparent border-r-transparent',
    right: 'right-full top-1/2 -translate-y-1/2 border-r-[var(--surface-2)] border-y-transparent border-l-transparent',
  };

  const animationClasses: Record<TooltipPosition, string> = {
    top: 'animate-tooltip-up',
    bottom: 'animate-tooltip-down',
    left: 'animate-tooltip-left',
    right: 'animate-tooltip-right',
  };

  return (
    <div
      ref={triggerRef}
      className={`relative inline-flex ${className}`}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
    >
      {children}
      {isMounted && content && (
        <div
          ref={setTooltipNode}
          role="tooltip"
          className={`
            absolute z-50 pointer-events-none
            ${positionClasses[actualPosition]}
            ${isVisible ? animationClasses[actualPosition] : ''}
            ${isVisible ? 'opacity-100' : 'opacity-0'}
          `}
        >
          {/* Tooltip content */}
          <div
            className="
              relative
              px-2.5 py-1.5
              text-xs font-medium
              text-stone-200
              whitespace-nowrap
              rounded-md
              bg-[var(--surface-2)]/95
              backdrop-blur-md
              border border-white/[0.08]
              shadow-lg shadow-black/30
            "
            style={{
              // Subtle warm inner glow at the top
              boxShadow: `
                inset 0 1px 0 rgba(255, 255, 255, 0.06),
                0 4px 12px rgba(0, 0, 0, 0.4),
                0 0 0 1px rgba(232, 166, 66, 0.08)
              `,
            }}
          >
            {/* Warm accent line at top */}
            <div
              className="absolute inset-x-0 top-0 h-px rounded-t-md"
              style={{
                background: 'linear-gradient(90deg, transparent 0%, rgba(232, 166, 66, 0.4) 50%, transparent 100%)',
              }}
            />
            {content}
          </div>
          {/* Arrow */}
          <div
            className={`
              absolute w-0 h-0
              border-[5px]
              ${arrowClasses[actualPosition]}
            `}
          />
        </div>
      )}
    </div>
  );
}
