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

  getChildren(element?: OpenHandsTreeItem): Thenable<OpenHandsTreeItem[]> {
    if (element) {
      return Promise.resolve([]);
    }

    // Provide quick entry points to the webview and extension settings.
    const items: OpenHandsTreeItem[] = [
      new OpenHandsTreeItem('Open Conversation Tab', {
        command: 'openhands.openTab',
        title: 'OpenHands: Open Tab',
      }, 'comment-discussion'),
      new OpenHandsTreeItem('Extension Settings', {
        command: 'workbench.action.openSettings',
        title: 'Open OpenHands Settings',
        arguments: ['@ext:openhands.openhands-tab'],
      }, 'gear'),
    ];

    return Promise.resolve(items);
  }
}
