import { act } from '@testing-library/react';

export function postToWindow(payload: unknown): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: payload }));
  });
}
