import * as vscode from 'vscode';

import { EXTENSION_NAMESPACE } from '../../constants';

export function getPinnedTasks(scope?: vscode.ConfigurationScope): string[] {
  const value = vscode.workspace
    .getConfiguration(EXTENSION_NAMESPACE, scope)
    .get<string[]>('pinnedTasks', []);

  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}
