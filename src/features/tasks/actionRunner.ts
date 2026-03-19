import * as vscode from 'vscode';

import { getConfiguredActionGroups } from './actionSettings';

export interface RunActionArgs {
  groupKey: string;
  groupTitle: string;
  label: string;
  description?: string;
  command: string;
}

const ACTION_TASK_SOURCE = 'Symfony Dev Tools';

export async function executeConfiguredAction(args: RunActionArgs): Promise<void> {
  const scope = vscode.workspace.workspaceFolders?.[0] ?? vscode.TaskScope.Workspace;
  const task = new vscode.Task(
    {
      type: 'shell',
      command: args.command,
      groupKey: args.groupKey,
    },
    scope,
    args.label,
    ACTION_TASK_SOURCE,
    new vscode.ShellExecution(args.command),
  );

  task.detail = args.command;
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    panel: vscode.TaskPanelKind.Dedicated,
  };

  await vscode.tasks.executeTask(task);
}

export async function promptForActionSelection(): Promise<RunActionArgs | undefined> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

  if (!workspaceFolder) {
    void vscode.window.showInformationMessage('Ouvre un workspace pour lancer une action Symfony.');
    return undefined;
  }

  const groups = getConfiguredActionGroups(workspaceFolder);
  const entries = groups.flatMap((group) =>
    group.actions.map((action) => ({
      label: action.label,
      description: group.title,
      detail: action.command,
      action: {
        groupKey: group.key,
        groupTitle: group.title,
        label: action.label,
        description: action.description,
        command: action.command,
      } satisfies RunActionArgs,
    })),
  );

  if (entries.length === 0) {
    void vscode.window.showInformationMessage('Aucune action Symfony n est configurée pour ce workspace.');
    return undefined;
  }

  const selection = await vscode.window.showQuickPick(entries, {
    placeHolder: 'Choisis une action Symfony a executer',
    matchOnDescription: true,
    matchOnDetail: true,
  });

  return selection?.action;
}
