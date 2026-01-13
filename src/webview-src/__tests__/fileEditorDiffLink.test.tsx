import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { FileEditorObservationSummary } from '../components/eventBlocks/shared';

const mockApi = { postMessage: vi.fn() };

describe('FileEditorObservationSummary diff link', () => {
  beforeEach(() => {
    mockApi.postMessage.mockClear();
    // @ts-expect-error define VS Code API mock on window
    window.acquireVsCodeApi = () => mockApi;
  });

  afterEach(() => {
    cleanup();
  });

  it('create: clicking the filename posts openWorkspaceDiff (preferGitHead)', async () => {
    render(
      <FileEditorObservationSummary
        observation={{
          command: 'create',
          path: 'src/foo.ts',
          prev_exist: false,
          old_content: null,
          new_content: 'console.log(1);',
        }}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'View diff for src/foo.ts' }));
    expect(mockApi.postMessage).toHaveBeenCalledWith({
      type: 'openWorkspaceDiff',
      path: 'src/foo.ts',
      oldContent: '',
      newContent: 'console.log(1);',
      preferGitHead: true,
    });
  });

  it('insert: clicking the filename posts openWorkspaceDiff (preferGitHead)', async () => {
    render(
      <FileEditorObservationSummary
        observation={{
          command: 'insert',
          path: 'README.md',
          old_content: 'old',
          new_content: 'new',
        }}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'View diff for README.md' }));
    expect(mockApi.postMessage).toHaveBeenCalledWith({
      type: 'openWorkspaceDiff',
      path: 'README.md',
      oldContent: 'old',
      newContent: 'new',
      preferGitHead: true,
    });
  });
});

