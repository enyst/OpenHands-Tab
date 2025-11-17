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

    describe('when no element is provided', () => {
      let children: vscode.TreeItem[];

      beforeEach(async () => {
        children = await provider.getChildren();
      });

      it('returns two root items', () => {
        expect(children).toHaveLength(2);
      });

      it('creates a correctly configured "Open Conversation Tab" item', () => {
        const conversationItem = children[0];
        expect(conversationItem.label).toBe('Open Conversation Tab');
        expect(conversationItem.command?.command).toBe('openhands.openTab');
        expect(conversationItem.command?.title).toBe('OpenHands: Open Tab');
        expect(conversationItem.iconPath).toBeInstanceOf(vscode.ThemeIcon);
        expect((conversationItem.iconPath as vscode.ThemeIcon).id).toBe('comment-discussion');
        expect(conversationItem.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
      });

      it('creates a correctly configured "Extension Settings" item', () => {
        const settingsItem = children[1];
        expect(settingsItem.label).toBe('Extension Settings');
        expect(settingsItem.command?.command).toBe('workbench.action.openSettings');
        expect(settingsItem.command?.title).toBe('Open OpenHands Settings');
        expect(settingsItem.command?.arguments).toEqual(['@ext:openhands.openhands-tab']);
        expect(settingsItem.iconPath).toBeInstanceOf(vscode.ThemeIcon);
        expect((settingsItem.iconPath as vscode.ThemeIcon).id).toBe('gear');
        expect(settingsItem.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
      });

      it('provides correct command structure for Open Conversation Tab item', () => {
        const conversationItem = children[0];
        expect(conversationItem.command).toEqual({
          command: 'openhands.openTab',
          title: 'OpenHands: Open Tab',
        });
      });

      it('provides correct command structure for Extension Settings item with arguments', () => {
        const settingsItem = children[1];
        expect(settingsItem.command).toEqual({
          command: 'workbench.action.openSettings',
          title: 'Open OpenHands Settings',
          arguments: ['@ext:openhands.openhands-tab'],
        });
      });
    });
  });
});
