import * as vscode from 'vscode';

import { COMMANDS } from '../../constants';
import { getConfiguredActionGroups } from './actionSettings';
import type { RunActionArgs } from './actionRunner';
import { getLastUsedActionsByGroup, type StoredActionReference } from './taskHistory';

export interface ActionDescriptor {
  id: string;
  label: string;
  description?: string;
  detail?: string;
  kind: 'action' | 'placeholder' | 'group';
  commandId?: string;
  commandArguments?: unknown[];
  children?: ActionDescriptor[];
  iconName?: string;
  color?: string;
  actionRef?: RunActionArgs;
  groupKey?: string;
  groupLabel?: string;
}

class ActionTreeItem extends vscode.TreeItem {
  public constructor(public readonly descriptor: ActionDescriptor) {
    super(
      descriptor.label,
      descriptor.kind === 'group'
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );

    this.id = descriptor.id;
    this.description = descriptor.description;
    this.tooltip = descriptor.detail ?? descriptor.description ?? descriptor.label;
    this.contextValue = descriptor.kind;

    if (descriptor.commandId) {
      this.command = {
        command: descriptor.commandId,
        title: descriptor.label,
        arguments: descriptor.commandArguments ?? [],
      };
    }

    this.iconPath = this.getIconPath(descriptor);
  }

  private getIconPath(descriptor: ActionDescriptor): vscode.ThemeIcon {
    const color = descriptor.color ? new vscode.ThemeColor(descriptor.color) : undefined;

    if (descriptor.kind === 'group') {
      return new vscode.ThemeIcon(descriptor.iconName ?? 'folder-library', color);
    }

    if (descriptor.kind === 'action') {
      return new vscode.ThemeIcon(descriptor.iconName ?? 'play', color);
    }

    return new vscode.ThemeIcon('info');
  }
}

export class ActionsViewProvider implements vscode.TreeDataProvider<ActionTreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<ActionTreeItem | void>();

  public constructor(private readonly state: vscode.Memento) {}

  public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  public refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  public getTreeItem(element: ActionTreeItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(element?: ActionTreeItem): Promise<ActionTreeItem[]> {
    const actions = element?.descriptor.children ?? (await this.getActionsSnapshot());

    return actions.map((descriptor) => new ActionTreeItem(descriptor));
  }

  public async getActionsSnapshot(): Promise<ActionDescriptor[]> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (!workspaceFolder) {
      return [
        {
          id: 'placeholder:no-workspace',
          label: 'Open a workspace to list configured Symfony actions',
          kind: 'placeholder',
        },
      ];
    }

    const groups = getConfiguredActionGroups(workspaceFolder);

    if (groups.length === 0) {
      return [
        {
          id: 'placeholder:no-actions',
          label: 'No Symfony actions configured',
          kind: 'placeholder',
        },
      ];
    }

    const lastUsedByGroup = getLastUsedActionsByGroup(this.state);

    return groups.map((group) => {
      const descriptors = group.actions.map((action) => this.toActionDescriptor(group.key, group.title, group.color, action));
      const lastUsedDescriptor = this.findLastUsedDescriptor(descriptors, lastUsedByGroup[group.key]);
      const children = lastUsedDescriptor
        ? [this.toLastUsedDescriptor(lastUsedDescriptor), ...descriptors.filter((descriptor) => descriptor.id !== lastUsedDescriptor.id)]
        : descriptors;

      return {
        id: `group:${group.key}`,
        label: group.title,
        description: group.description,
        detail: group.description,
        kind: 'group',
        iconName: group.icon,
        color: group.color,
        children,
      };
    });
  }

  private toActionDescriptor(
    groupKey: string,
    groupTitle: string,
    groupColor: string | undefined,
    action: { label: string; description?: string; command: string },
  ): ActionDescriptor {
    const actionRef: RunActionArgs = {
      groupKey,
      groupTitle,
      label: action.label,
      description: action.description,
      command: action.command,
    };

    return {
      id: `action:${groupKey}:${action.label}`,
      label: action.label,
      description: action.description,
      detail: action.command,
      kind: 'action',
      iconName: 'play',
      color: groupColor,
      commandId: COMMANDS.runAction,
      commandArguments: [actionRef],
      actionRef,
      groupKey,
      groupLabel: groupTitle,
    };
  }

  private findLastUsedDescriptor(
    descriptors: ActionDescriptor[],
    lastUsedAction: StoredActionReference | undefined,
  ): ActionDescriptor | undefined {
    if (!lastUsedAction) {
      return undefined;
    }

    return descriptors.find(
      (descriptor) =>
        descriptor.actionRef?.label === lastUsedAction.label
        && descriptor.actionRef?.command === lastUsedAction.command,
    );
  }

  private toLastUsedDescriptor(descriptor: ActionDescriptor): ActionDescriptor {
    return {
      ...descriptor,
      id: `last-used:${descriptor.id}`,
      description: 'Last used',
      iconName: 'history',
    };
  }
}
