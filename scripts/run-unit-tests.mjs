import fs from 'node:fs/promises';
import path from 'node:path';
import Mocha from 'mocha';

const mocha = new Mocha({
  ui: 'bdd',
  color: true,
});

const testsRoot = path.resolve('dist/test/unit');
const testFiles = await collectTestFiles(testsRoot);

for (const filePath of testFiles) {
  mocha.addFile(filePath);
}

await new Promise((resolve, reject) => {
  mocha.run((failures) => {
    if (failures > 0) {
      reject(new Error(`${failures} unit test(s) failed.`));
      return;
    }

    resolve(undefined);
  });
});

async function collectTestFiles(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectTestFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.test.js')) {
      files.push(fullPath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}
