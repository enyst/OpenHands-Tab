import * as vscode from 'vscode';

class OpenHandsTreeItem extends vscode.TreeItem {
  constructor(label: string, command: vscode.Command | undefined, iconId: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.command = command;
    this.iconPath = new vscode.ThemeIcon(iconId);
  }
}

export class OpenHandsViewProvider implements vscode.TreeDataProvider<OpenHandsTreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<OpenHandsTreeItem | void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  getTreeItem(element: OpenHandsTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(_element?: OpenHandsTreeItem): Thenable<OpenHandsTreeItem[]> {
    // Return empty - clicking the sidebar icon triggers onDidChangeVisibility
    // which opens the OpenHands Tab directly
    return Promise.resolve([]);
  }
}
