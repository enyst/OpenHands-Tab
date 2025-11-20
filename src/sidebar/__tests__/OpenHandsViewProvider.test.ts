import { describe, it, expect, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { OpenHandsViewProvider } from '../OpenHandsViewProvider';

describe('OpenHandsViewProvider', () => {
  let provider: OpenHandsViewProvider;

  beforeEach(() => {
    provider = new OpenHandsViewProvider();
  });

  describe('TreeDataProvider implementation', () => {
    it('getTreeItem returns the element unchanged', () => {
      const mockItem = new vscode.TreeItem('Test Item');
      const result = provider.getTreeItem(mockItem);
      expect(result).toBe(mockItem);
    });

    it('getChildren returns empty array', async () => {
      const children = await provider.getChildren();
      expect(children).toEqual([]);
    });
  });
});
