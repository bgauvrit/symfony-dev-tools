import * as vscode from 'vscode';

import { EXTENSION_NAMESPACE } from '../../constants';
import { resolveActionGroups, type ResolvedActionGroup } from './actionConfig';

export function getConfiguredActionGroups(scope?: vscode.ConfigurationScope): ResolvedActionGroup[] {
  const configuration = vscode.workspace.getConfiguration(EXTENSION_NAMESPACE, scope);
  const rawValue = configuration.get<unknown>('actions', {});

  return resolveActionGroups(rawValue);
}
