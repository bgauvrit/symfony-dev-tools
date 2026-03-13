import * as vscode from 'vscode';

export interface TaskGroupDescriptor {
  key: string;
  label: string;
  iconName: string;
  iconColor: string;
}

const DEFAULT_TASK_GROUP: TaskGroupDescriptor = {
  key: 'other',
  label: 'Other',
  iconName: 'terminal',
  iconColor: 'charts.foreground',
};

export function buildTaskId(task: vscode.Task): string {
  return `${task.source}:${task.name}`;
}

export function getTaskCommandLine(task: vscode.Task): string | undefined {
  if (task.execution instanceof vscode.ShellExecution) {
    if (task.execution.commandLine) {
      return task.execution.commandLine;
    }

    const command = typeof task.execution.command === 'string'
      ? task.execution.command
      : task.execution.command?.value;
    const args = (task.execution.args ?? []).map((entry) =>
      typeof entry === 'string' ? entry : entry.value,
    );

    return [command, ...args].filter(Boolean).join(' ').trim() || undefined;
  }

  if (task.execution instanceof vscode.ProcessExecution) {
    return [task.execution.process, ...(task.execution.args ?? [])].filter(Boolean).join(' ').trim() || undefined;
  }

  return undefined;
}

export function getTaskGroup(commandLine?: string): TaskGroupDescriptor | undefined {
  if (!commandLine) {
    return undefined;
  }

  const trimmed = commandLine.trim();
  const lower = trimmed.toLowerCase();

  if (lower.includes('npm run ')) {
    return {
      key: 'npm-run',
      label: 'npm run',
      iconName: 'package',
      iconColor: 'charts.green',
    };
  }

  if (lower.includes('pnpm run ')) {
    return {
      key: 'pnpm-run',
      label: 'pnpm run',
      iconName: 'package',
      iconColor: 'charts.blue',
    };
  }

  if (lower.includes('yarn ')) {
    return {
      key: 'yarn',
      label: 'yarn',
      iconName: 'package',
      iconColor: 'charts.purple',
    };
  }

  if (lower.includes('php bin/console make:')) {
    return {
      key: 'php-bin-console-make',
      label: 'php bin/console make',
      iconName: 'wrench',
      iconColor: 'charts.blue',
    };
  }

  if (lower.includes('php bin/console doctrine:')) {
    return {
      key: 'php-bin-console-doctrine',
      label: 'php bin/console doctrine',
      iconName: 'database',
      iconColor: 'charts.orange',
    };
  }

  if (lower.includes('php bin/console ')) {
    return {
      key: 'php-bin-console',
      label: 'php bin/console',
      iconName: 'terminal',
      iconColor: 'charts.yellow',
    };
  }

  if (lower.includes('symfony ')) {
    return {
      key: 'symfony',
      label: 'symfony',
      iconName: 'rocket',
      iconColor: 'charts.purple',
    };
  }

  const firstSegment = trimmed.split(/[;&|]/, 1)[0]?.trim();

  if (!firstSegment) {
    return undefined;
  }

  const tokens = firstSegment.split(/\s+/).slice(0, 2);

  if (tokens.length === 0) {
    return undefined;
  }

  const label = tokens.join(' ');

  return {
    ...DEFAULT_TASK_GROUP,
    key: label.toLowerCase(),
    label,
  };
}
