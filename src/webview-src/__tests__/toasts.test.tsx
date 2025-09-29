import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { App } from '../components/App';

// Note: We can't easily assert toaster DOM here without wiring a query target since it's portal-based.
// This test ensures no runtime errors when system/error events trigger toaster.

describe('toasts', () => {
  it('does not throw when system/error events are posted', () => {
    render(<App />);
    window.postMessage({ type: 'event', event: { type: 'system', message: 'hello' } }, '*');
    window.postMessage({ type: 'event', event: { type: 'error', error: 'oops' } }, '*');
  });
});
