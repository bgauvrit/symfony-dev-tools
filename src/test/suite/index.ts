import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import Mocha from 'mocha';

export async function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'bdd',
    color: true,
  });

  const testsRoot = __dirname;
  const entries = await fs.readdir(testsRoot, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.integration.test.js')) {
      continue;
    }

    mocha.addFile(path.join(testsRoot, entry.name));
  }

  await new Promise<void>((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} integration test(s) failed.`));
        return;
      }

      resolve();
    });
  });
}
