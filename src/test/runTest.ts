import * as path from 'node:path';

import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '../..');
  const extensionTestsPath = path.resolve(__dirname, './suite/index');
  const workspacePath =
    process.env.VSCODE_TEST_WORKSPACE ?? path.resolve(extensionDevelopmentPath, 'test-fixtures/workspace/project');
  const vscodeExecutablePath =
    process.env.VSCODE_EXECUTABLE_PATH ??
    path.resolve(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd');

  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [workspacePath],
  });
}

void main().catch((error) => {
  console.error('Failed to run extension tests');
  console.error(error);
  process.exit(1);
});
