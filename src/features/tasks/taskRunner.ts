import * as vscode from 'vscode';

import { getTaskCommandLine } from './taskGrouping';

export interface RunTaskArgs {
  taskLabel: string;
  taskSource?: string;
}

export async function listWorkspaceTasks(): Promise<vscode.Task[]> {
  const tasks = await vscode.tasks.fetchTasks();

  return tasks.filter((task) => task.scope !== vscode.TaskScope.Global && !shouldHideTask(task));
}

export async function findWorkspaceTask(args: RunTaskArgs): Promise<vscode.Task | undefined> {
  const tasks = await listWorkspaceTasks();

  return tasks.find((task) => {
    if (task.name !== args.taskLabel) {
      return false;
    }

    if (!args.taskSource) {
      return true;
    }

    return task.source === args.taskSource;
  });
}

export async function executeWorkspaceTask(args: RunTaskArgs): Promise<void> {
  const task = await findWorkspaceTask(args);

  if (!task) {
    throw new Error(`La tâche workspace "${args.taskLabel}" est introuvable ou a été supprimée.`);
  }

  await vscode.tasks.executeTask(task);
}

function shouldHideTask(task: vscode.Task): boolean {
  const source = task.source.toLowerCase();
  const normalizedName = normalizeTaskToken(task.name);
  const normalizedCommandLine = normalizeTaskToken(getTaskCommandLine(task) ?? '');

  if (source.includes('cmake')) {
    return true;
  }

  if (normalizedCommandLine === 'npm install' || normalizedName === 'npm install' || normalizedName === 'install') {
    return true;
  }

  if (normalizedName === 'webpack' || normalizedName === 'webpack build' || normalizedName === 'webpack (build)') {
    return true;
  }

  if (normalizedCommandLine === 'npm run watch' || normalizedCommandLine === 'npm run build') {
    return true;
  }

  return false;
}

function normalizeTaskToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
