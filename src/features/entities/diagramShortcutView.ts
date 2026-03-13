import * as vscode from 'vscode';

import { COMMANDS } from '../../constants';

interface ShortcutDescriptor {
  id: string;
  label: string;
  description?: string;
  iconName: string;
  commandId?: string;
}

class DiagramShortcutTreeItem extends vscode.TreeItem {
  public constructor(private readonly descriptor: ShortcutDescriptor) {
    super(descriptor.label, vscode.TreeItemCollapsibleState.None);

    this.id = descriptor.id;
    this.description = descriptor.description;
    this.tooltip = descriptor.description ?? descriptor.label;
    this.iconPath = new vscode.ThemeIcon(descriptor.iconName, new vscode.ThemeColor('charts.blue'));

    if (descriptor.commandId) {
      this.command = {
        command: descriptor.commandId,
        title: descriptor.label,
      };
    }
  }
}

export class DiagramShortcutViewProvider implements vscode.TreeDataProvider<DiagramShortcutTreeItem> {
  public getTreeItem(element: DiagramShortcutTreeItem): vscode.TreeItem {
    return element;
  }

  public getChildren(): DiagramShortcutTreeItem[] {
    return [
      new DiagramShortcutTreeItem({
        id: 'diagram:open',
        label: 'Open diagram',
        description: 'Open the Doctrine UML diagram in a panel',
        iconName: 'go-to-file',
        commandId: COMMANDS.openEntityDiagram,
      }),
      new DiagramShortcutTreeItem({
        id: 'diagram:hint',
        label: 'Panel mode enabled',
        description: 'The full UML now opens in the editor area',
        iconName: 'info',
      }),
    ];
  }
}
