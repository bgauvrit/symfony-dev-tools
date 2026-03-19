import * as vscode from 'vscode';

import type { RunActionArgs } from './actionRunner';

const LAST_USED_ACTIONS_BY_GROUP_KEY = 'actions.lastUsedByGroup';

export interface StoredActionReference {
  label: string;
  command: string;
  executedAt: string;
}

export interface StoredActionReferenceMap {
  [groupKey: string]: StoredActionReference | undefined;
}

export function getLastUsedActionsByGroup(state: vscode.Memento): StoredActionReferenceMap {
  const value = state.get<StoredActionReferenceMap>(LAST_USED_ACTIONS_BY_GROUP_KEY);

  if (!value || typeof value !== 'object') {
    return {};
  }

  return value;
}

export async function setLastUsedActionForGroup(
  state: vscode.Memento,
  groupKey: string,
  args: RunActionArgs,
): Promise<void> {
  if (!groupKey) {
    return;
  }

  const currentEntries = getLastUsedActionsByGroup(state);
  const payload: StoredActionReference = {
    label: args.label,
    command: args.command,
    executedAt: new Date().toISOString(),
  };

  await state.update(LAST_USED_ACTIONS_BY_GROUP_KEY, {
    ...currentEntries,
    [groupKey]: payload,
  });
}
