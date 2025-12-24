import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ServerSelector } from '../components/ServerSelector';

describe('ServerSelector', () => {
  it('shows the add-server form immediately without closing the dropdown', () => {
    const onClose = vi.fn();

    render(
      <ServerSelector
        isOpen
        onClose={onClose}
        servers={[]}
        currentServerUrl={undefined}
        mode="remote"
        onSelectServer={() => {}}
        onAddServer={() => {}}
        onRemoveServer={() => {}}
        onSwitchToLocal={() => {}}
      />
    );

    const addButton = screen.getByRole('button', { name: 'Add Server' });
    fireEvent.click(addButton);

    expect(onClose).not.toHaveBeenCalled();
    const urlInput = screen.getByPlaceholderText('https://server-url...');
    expect(urlInput).toHaveFocus();
  });
});
