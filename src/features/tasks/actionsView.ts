import * as vscode from 'vscode';

import { COMMANDS } from '../../constants';
import { getLastUsedTasksByGroup, type StoredTaskReference } from './taskHistory';
import { buildTaskId, getTaskCommandLine, getTaskGroup } from './taskGrouping';
import { getPinnedTasks } from './taskSettings';
import { listWorkspaceTasks, type RunTaskArgs } from './taskRunner';

export interface ActionDescriptor {
  id: string;
  label: string;
  description?: string;
  detail?: string;
  kind: 'command' | 'task' | 'placeholder' | 'group';
  commandId?: string;
  commandArguments?: unknown[];
  children?: ActionDescriptor[];
  iconName?: string;
  iconColor?: string;
  taskRef?: RunTaskArgs;
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

    const iconName = descriptor.iconName ?? this.getDefaultIconName(descriptor);
    const iconColor = descriptor.iconColor ? new vscode.ThemeColor(descriptor.iconColor) : undefined;
    this.iconPath = new vscode.ThemeIcon(iconName, iconColor);
  }

  private getDefaultIconName(descriptor: ActionDescriptor): string {
    if (descriptor.kind === 'command') {
      if (descriptor.commandId === COMMANDS.refreshEntityDiagram || descriptor.commandId === COMMANDS.scanTranslations) {
        return 'refresh';
      }

      if (descriptor.commandId === COMMANDS.syncTranslations) {
        return 'sync';
      }

      if (descriptor.commandId === COMMANDS.insertTemplate) {
        return 'new-file';
      }

      if (descriptor.commandId === COMMANDS.createSymfonyProject) {
        return 'rocket';
      }

      if (descriptor.commandId === COMMANDS.openTranslationsReport) {
        return 'symbol-key';
      }

      return 'symbol-class';
    }

    if (descriptor.kind === 'task') {
      return 'play';
    }

    if (descriptor.kind === 'group') {
      return 'folder-library';
    }

    return 'info';
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
          label: 'Open a workspace to list tasks and entities',
          kind: 'placeholder',
        },
      ];
    }

    const tasks = await listWorkspaceTasks();

    if (tasks.length === 0) {
      return [
        {
          id: 'placeholder:no-tasks',
          label: 'No workspace tasks found',
          kind: 'placeholder',
        },
      ];
    }

    const pinnedLabels = getPinnedTasks(workspaceFolder);
    const quickAccess: ActionDescriptor[] = [];

    for (const label of pinnedLabels) {
      const matchingTasks = tasks.filter((task) => task.name === label);

      for (const task of matchingTasks) {
        const descriptor = this.toTaskDescriptor(task, {
          idPrefix: 'pinned',
          description: 'Pinned',
          iconName: 'pin',
        });
        quickAccess.push(descriptor);
      }
    }

    const grouped = this.groupTaskDescriptors(tasks.map((task) => this.toTaskDescriptor(task)));

    return [...quickAccess, ...grouped];
  }

  private groupTaskDescriptors(taskDescriptors: ActionDescriptor[]): ActionDescriptor[] {
    const lastUsedByGroup = getLastUsedTasksByGroup(this.state);
    const groupedTasks = new Map<
      string,
      {
        label: string;
        iconName?: string;
        iconColor?: string;
        descriptors: ActionDescriptor[];
      }
    >();
    const ungrouped: ActionDescriptor[] = [];

    for (const descriptor of taskDescriptors) {
      if (!descriptor.groupKey) {
        ungrouped.push(descriptor);
        continue;
      }

      const group = groupedTasks.get(descriptor.groupKey) ?? {
        label: descriptor.groupLabel ?? descriptor.groupKey,
        iconName: descriptor.iconName,
        iconColor: descriptor.iconColor,
        descriptors: [],
      };
      group.descriptors.push(descriptor);
      groupedTasks.set(descriptor.groupKey, group);
    }

    const groupedDescriptors: ActionDescriptor[] = [];

    for (const [groupKey, group] of groupedTasks.entries()) {
      const descriptors = group.descriptors.sort((left, right) => left.label.localeCompare(right.label));
      const lastUsedDescriptor = this.findLastUsedDescriptor(descriptors, lastUsedByGroup[groupKey]);
      const children = lastUsedDescriptor
        ? [this.toLastUsedDescriptor(lastUsedDescriptor), ...descriptors.filter((descriptor) => descriptor.id !== lastUsedDescriptor.id)]
        : descriptors;

      groupedDescriptors.push({
        id: `group:${groupKey}`,
        label: group.label,
        description: `${descriptors.length} tasks`,
        kind: 'group',
        iconName: group.iconName,
        iconColor: group.iconColor,
        children,
      });
    }

    return [
      ...groupedDescriptors.sort((left, right) => left.label.localeCompare(right.label)),
      ...ungrouped.sort((left, right) => left.label.localeCompare(right.label)),
    ];
  }

  private toTaskDescriptor(
    task: vscode.Task,
    overrides: Partial<Pick<ActionDescriptor, 'id' | 'label' | 'description' | 'iconName' | 'iconColor'>> & {
      idPrefix?: string;
    } = {},
  ): ActionDescriptor {
    const args: RunTaskArgs = {
      taskLabel: task.name,
      taskSource: task.source,
    };
    const taskId = buildTaskId(task);
    const commandLine = getTaskCommandLine(task);
    const group = getTaskGroup(commandLine);

    return {
      id: overrides.id ?? `${overrides.idPrefix ?? 'task'}:${taskId}`,
      label: overrides.label ?? task.name,
      description: overrides.description ?? task.source,
      detail: commandLine ?? task.detail ?? undefined,
      kind: 'task',
      commandId: COMMANDS.runTask,
      commandArguments: [args],
      iconName: overrides.iconName,
      iconColor: overrides.iconColor ?? group?.iconColor,
      taskRef: args,
      groupKey: group?.key,
      groupLabel: group?.label,
    };
  }

  private findLastUsedDescriptor(
    descriptors: ActionDescriptor[],
    lastUsedTask: StoredTaskReference | undefined,
  ): ActionDescriptor | undefined {
    if (!lastUsedTask) {
      return undefined;
    }

    return descriptors.find(
      (descriptor) =>
        descriptor.taskRef?.taskLabel === lastUsedTask.taskLabel
        && (!lastUsedTask.taskSource || descriptor.taskRef?.taskSource === lastUsedTask.taskSource),
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
