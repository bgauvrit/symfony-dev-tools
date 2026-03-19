import * as path from 'node:path';

import { buildDefaultActionsConfiguration } from '../tasks/actionConfig';

export type SymfonyProjectModule =
  | 'twig'
  | 'security'
  | 'translation'
  | 'encore'
  | 'stimulus'
  | 'turbo'
  | 'maker'
  | 'phpunit'
  | 'easyadmin';

export interface SymfonyProjectBootstrapOptions {
  targetRoot: string;
  projectName: string;
  modules: SymfonyProjectModule[];
}

export function buildSymfonyProjectScript(options: SymfonyProjectBootstrapOptions): string {
  return process.platform === 'win32' ? buildPowershellScript(options) : buildBashScript(options);
}

function buildPowershellScript(options: SymfonyProjectBootstrapOptions): string {
  const projectPath = path.join(options.targetRoot, options.projectName);
  const composerPackages = buildComposerPackages(options.modules);
  const composerDevPackages = buildComposerDevPackages(options.modules);
  const lines = [
    `$projectRoot = '${escapeSingleQuotes(projectPath)}'`,
    "composer create-project symfony/skeleton $projectRoot",
    'Set-Location $projectRoot',
    ...(composerPackages.length > 0 ? [`composer require ${composerPackages.join(' ')}`] : []),
    ...(composerDevPackages.length > 0 ? [`composer require --dev ${composerDevPackages.join(' ')}`] : []),
    ...(options.modules.includes('encore') ? ['npm install'] : []),
    "@'\n" + buildWorkspaceFile(options.projectName) + "\n'@ | Set-Content -Encoding UTF8 '" + escapeSingleQuotes(`${options.projectName}.code-workspace`) + "'",
  ];

  return lines.join('\n');
}

function buildBashScript(options: SymfonyProjectBootstrapOptions): string {
  const projectPath = path.join(options.targetRoot, options.projectName).replace(/\\/g, '/');
  const composerPackages = buildComposerPackages(options.modules);
  const composerDevPackages = buildComposerDevPackages(options.modules);
  const lines = [
    `project_root='${projectPath.replace(/'/g, "'\\''")}'`,
    'composer create-project symfony/skeleton "$project_root"',
    'cd "$project_root"',
    ...(composerPackages.length > 0 ? [`composer require ${composerPackages.join(' ')}`] : []),
    ...(composerDevPackages.length > 0 ? [`composer require --dev ${composerDevPackages.join(' ')}`] : []),
    ...(options.modules.includes('encore') ? ['npm install'] : []),
    `cat <<'EOF' > ${options.projectName}.code-workspace\n${buildWorkspaceFile(options.projectName)}\nEOF`,
  ];

  return lines.join('\n');
}

function buildComposerPackages(modules: SymfonyProjectModule[]): string[] {
  const packages: string[] = [];

  if (modules.includes('twig')) {
    packages.push('symfony/twig-bundle');
  }

  if (modules.includes('security')) {
    packages.push('symfony/security-bundle');
  }

  if (modules.includes('translation')) {
    packages.push('symfony/translation');
  }

  if (modules.includes('encore')) {
    packages.push('symfony/webpack-encore-bundle');
  }

  if (modules.includes('stimulus')) {
    packages.push('symfony/stimulus-bundle');
  }

  if (modules.includes('turbo')) {
    packages.push('symfony/ux-turbo');
  }

  if (modules.includes('easyadmin')) {
    packages.push('easycorp/easyadmin-bundle');
  }

  return packages;
}

function buildComposerDevPackages(modules: SymfonyProjectModule[]): string[] {
  const packages: string[] = [];

  if (modules.includes('maker')) {
    packages.push('symfony/maker-bundle');
  }

  if (modules.includes('phpunit')) {
    packages.push(
      'phpunit/phpunit',
      'symfony/browser-kit',
      'symfony/css-selector',
      'symfony/debug-bundle',
      'symfony/web-profiler-bundle',
    );
  }

  return packages;
}

function buildWorkspaceFile(projectName: string): string {
  return JSON.stringify(
    {
      folders: [
        {
          path: '.',
        },
      ],
      settings: {
        'symfonyDevTools.actions': buildDefaultActionsConfiguration(),
        'files.exclude': {
          var: true,
        },
      },
    },
    null,
    2,
  );
}

function escapeSingleQuotes(value: string): string {
  return value.replace(/'/g, "''");
}
