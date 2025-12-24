import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCloseOnEscapeAndOutsideClick } from '../components/useCloseOnEscapeAndOutsideClick';

function PopoverTargetRemovalRepro({ onClose }: { onClose: () => void }) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [showButton, setShowButton] = useState(true);

  useCloseOnEscapeAndOutsideClick({
    isOpen: true,
    onClose: () => onClose(),
    ref: popoverRef,
    delay: 100,
  });

  return (
    <div ref={popoverRef}>
      {showButton && (
        <button type="button" onClick={() => setShowButton(false)}>
          Remove Target
        </button>
      )}
    </div>
  );
}

describe('useCloseOnEscapeAndOutsideClick', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not treat an inside click as outside when the click target is removed before the document handler runs', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();

    render(<PopoverTargetRemovalRepro onClose={onClose} />);

    act(() => {
      vi.advanceTimersByTime(150);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Remove Target' }));

    expect(onClose).not.toHaveBeenCalled();
  });
});

