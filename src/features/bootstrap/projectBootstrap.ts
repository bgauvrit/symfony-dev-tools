import * as os from 'node:os';
import * as path from 'node:path';

import * as vscode from 'vscode';

import {
  buildSymfonyProjectScript,
  type SymfonyProjectBootstrapOptions,
  type SymfonyProjectModule,
} from './bootstrapScript';

export { buildSymfonyProjectScript, type SymfonyProjectBootstrapOptions, type SymfonyProjectModule } from './bootstrapScript';

export const DEFAULT_SYMFONY_PROJECT_MODULES: SymfonyProjectModule[] = [
  'twig',
  'security',
  'translation',
  'encore',
  'stimulus',
  'turbo',
  'maker',
];

export const AVAILABLE_SYMFONY_PROJECT_MODULES: Array<{
  value: SymfonyProjectModule;
  label: string;
  description: string;
}> = [
  { value: 'twig', label: 'Twig', description: 'Twig templating support' },
  { value: 'security', label: 'Security', description: 'Symfony Security bundle' },
  { value: 'translation', label: 'Translation', description: 'Symfony translation support' },
  { value: 'encore', label: 'Webpack Encore', description: 'Webpack Encore assets pipeline' },
  { value: 'stimulus', label: 'Stimulus', description: 'Stimulus bundle' },
  { value: 'turbo', label: 'Turbo', description: 'Symfony UX Turbo' },
  { value: 'maker', label: 'Maker', description: 'Symfony Maker bundle' },
  { value: 'phpunit', label: 'PHPUnit', description: 'PHPUnit and browser-kit dev stack' },
  { value: 'easyadmin', label: 'EasyAdmin', description: 'EasyAdmin backoffice' },
];

export async function createSymfonyProject(): Promise<void> {
  const projectName = (await vscode.window.showInputBox({
    title: 'Create Symfony project',
    prompt: 'Project name',
    value: 'my-symfony-app',
  }))?.trim();

  if (!projectName) {
    return;
  }

  const defaultRoot = vscode.workspace.workspaceFolders?.[0]
    ? path.dirname(vscode.workspace.workspaceFolders[0].uri.fsPath)
    : os.homedir();
  const targetRoot = (await vscode.window.showInputBox({
    title: 'Create Symfony project',
    prompt: 'Target root directory',
    value: defaultRoot,
  }))?.trim();

  if (!targetRoot) {
    return;
  }

  const pickedModules = await vscode.window.showQuickPick(
    AVAILABLE_SYMFONY_PROJECT_MODULES.map((module) => ({
      label: module.label,
      description: module.description,
      picked: DEFAULT_SYMFONY_PROJECT_MODULES.includes(module.value),
      module: module.value,
    })),
    {
      title: 'Symfony project modules',
      canPickMany: true,
      placeHolder: 'Choose the Symfony modules to install',
    },
  );

  if (!pickedModules || pickedModules.length === 0) {
    return;
  }

  const modules = pickedModules.map((entry) => entry.module);
  const terminal = vscode.window.createTerminal({
    name: `Symfony Bootstrap: ${projectName}`,
  });

  terminal.show(true);
  terminal.sendText(buildSymfonyProjectScript({
    targetRoot,
    projectName,
    modules,
  }), true);
}
