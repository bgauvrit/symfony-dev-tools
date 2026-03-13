import * as path from 'node:path';

import * as vscode from 'vscode';

import { EXTENSION_NAMESPACE } from '../../constants';

export interface EntitySettings {
  entityRoots: string[];
  autoRefreshDiagram: boolean;
  includeMappedSuperclass: boolean;
}

export function getEntitySettings(scope?: vscode.ConfigurationScope): EntitySettings {
  const configuration = vscode.workspace.getConfiguration(EXTENSION_NAMESPACE, scope);
  const entityRoots = configuration.get<string[]>('entityRoots', ['src/Entity']);

  return {
    entityRoots: entityRoots.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0),
    autoRefreshDiagram: configuration.get<boolean>('autoRefreshDiagram', true),
    includeMappedSuperclass: configuration.get<boolean>('includeMappedSuperclass', false),
  };
}

export function resolveEntityRoots(workspaceFolder: vscode.WorkspaceFolder): string[] {
  const settings = getEntitySettings(workspaceFolder);

  return settings.entityRoots.map((root) =>
    path.isAbsolute(root)
      ? path.normalize(root)
      : path.normalize(path.join(workspaceFolder.uri.fsPath, root)),
  );
}
