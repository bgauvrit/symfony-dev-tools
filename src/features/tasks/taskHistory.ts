import * as vscode from 'vscode';

import type { RunTaskArgs } from './taskRunner';

const LAST_USED_TASKS_BY_GROUP_KEY = 'tasks.lastUsedByGroup';

export interface StoredTaskReference extends RunTaskArgs {
  executedAt: string;
}

export interface StoredTaskReferenceMap {
  [groupKey: string]: StoredTaskReference | undefined;
}

export function getLastUsedTasksByGroup(state: vscode.Memento): StoredTaskReferenceMap {
  const value = state.get<StoredTaskReferenceMap>(LAST_USED_TASKS_BY_GROUP_KEY);

  if (!value || typeof value !== 'object') {
    return {};
  }

  return value;
}

export async function setLastUsedTaskForGroup(
  state: vscode.Memento,
  groupKey: string,
  args: RunTaskArgs,
): Promise<void> {
  if (!groupKey) {
    return;
  }

  const currentEntries = getLastUsedTasksByGroup(state);
  const payload: StoredTaskReference = {
    taskLabel: args.taskLabel,
    taskSource: args.taskSource,
    executedAt: new Date().toISOString(),
  };

  await state.update(LAST_USED_TASKS_BY_GROUP_KEY, {
    ...currentEntries,
    [groupKey]: payload,
  });
}
