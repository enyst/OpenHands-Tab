import { describe, it, expect, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { OpenHandsViewProvider } from '../OpenHandsViewProvider';

describe('OpenHandsViewProvider', () => {
  let provider: OpenHandsViewProvider;

  beforeEach(() => {
    provider = new OpenHandsViewProvider();
  });

  describe('TreeDataProvider implementation', () => {
    it('provides onDidChangeTreeData event emitter', () => {
      expect(provider.onDidChangeTreeData).toBeDefined();
    });

    it('getTreeItem returns the element unchanged', () => {
      const mockItem = new vscode.TreeItem('Test Item');
      const result = provider.getTreeItem(mockItem as any);
      expect(result).toBe(mockItem);
    });
  });

  describe('getChildren', () => {
    it('returns empty array when element is provided (no nested items)', async () => {
      const mockElement = new vscode.TreeItem('Parent');
      const children = await provider.getChildren(mockElement as any);
      expect(children).toEqual([]);
    });

    it('returns root items when no element is provided', async () => {
      const children = await provider.getChildren();

      expect(children).toHaveLength(2);
      expect(children[0].label).toBe('Open Conversation Tab');
      expect(children[0].command?.command).toBe('openhands.openTab');
      expect(children[0].command?.title).toBe('OpenHands: Open Tab');
      expect(children[0].iconPath).toBeInstanceOf(vscode.ThemeIcon);

      expect(children[1].label).toBe('Extension Settings');
      expect(children[1].command?.command).toBe('workbench.action.openSettings');
      expect(children[1].command?.title).toBe('Open OpenHands Settings');
      expect(children[1].command?.arguments).toEqual(['@ext:openhands.openhands-tab']);
    });

    it('creates tree items with correct icons', async () => {
      const children = await provider.getChildren();

      const conversationItem = children[0];
      expect((conversationItem.iconPath as vscode.ThemeIcon).id).toBe('comment-discussion');

      const settingsItem = children[1];
      expect((settingsItem.iconPath as vscode.ThemeIcon).id).toBe('gear');
    });

    it('creates non-collapsible tree items', async () => {
      const children = await provider.getChildren();

      children.forEach(item => {
        expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
      });
    });

    it('provides correct command structure for Open Conversation Tab item', async () => {
      const children = await provider.getChildren();
      const conversationItem = children[0];

      expect(conversationItem.command).toEqual({
        command: 'openhands.openTab',
        title: 'OpenHands: Open Tab',
      });
    });

    it('provides correct command structure for Extension Settings item with arguments', async () => {
      const children = await provider.getChildren();
      const settingsItem = children[1];

      expect(settingsItem.command).toEqual({
        command: 'workbench.action.openSettings',
        title: 'Open OpenHands Settings',
        arguments: ['@ext:openhands.openhands-tab'],
      });
    });
  });
});
