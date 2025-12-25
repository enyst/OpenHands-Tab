import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBanner } from '../components/StatusBanner';

describe('StatusBanner', () => {
  it('renders without toast-style chrome (border/rounded/shadow)', () => {
    render(
      <StatusBanner
        message="Local mode: running without remote server"
        level="info"
        onDismiss={() => {}}
        dismissible={false}
        autoDismiss={false}
      />
    );

    const banner = screen.getByRole('alert');
    expect(banner).not.toHaveClass('border');
    expect(banner).not.toHaveClass('rounded-lg');
    expect(banner.className).not.toContain('shadow-event');
  });
});

