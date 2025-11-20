import * as vscode from 'vscode';

/**
 * Empty tree provider - the sidebar icon click triggers onDidChangeVisibility
 * which opens the OpenHands Tab directly.
 */
export class OpenHandsViewProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): Thenable<vscode.TreeItem[]> {
    return Promise.resolve([]);
  }
}
