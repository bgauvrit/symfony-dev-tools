import * as assert from 'node:assert/strict';

import { buildSymfonyProjectScript } from '../../features/bootstrap/bootstrapScript';

describe('Symfony project bootstrap script', () => {
  it('includes the selected Symfony modules and workspace defaults', () => {
    const script = buildSymfonyProjectScript({
      targetRoot: '/workspace',
      projectName: 'demo-app',
      modules: ['twig', 'translation', 'encore', 'maker', 'phpunit'],
    });

    assert.equal(script.includes('composer create-project symfony/skeleton'), true);
    assert.equal(script.includes('symfony/twig-bundle'), true);
    assert.equal(script.includes('symfony/translation'), true);
    assert.equal(script.includes('symfony/webpack-encore-bundle'), true);
    assert.equal(script.includes('symfony/maker-bundle'), true);
    assert.equal(script.includes('phpunit/phpunit'), true);
    assert.equal(script.includes('npm install'), true);
    assert.equal(script.includes('"symfonyDevTools.pinnedTasks"'), true);
    assert.equal(script.includes('Run server'), true);
  });
});
