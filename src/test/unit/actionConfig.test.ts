import * as assert from 'node:assert/strict';

import {
  buildDefaultActionsConfiguration,
  isThemeColorId,
  normalizeIconName,
  resolveActionGroups,
} from '../../features/tasks/actionConfig';

describe('Symfony action config', () => {
  it('loads built-in groups in the expected order', () => {
    const groups = resolveActionGroups({});

    assert.deepEqual(groups.map((group) => group.key), [
      'cache',
      'doctrine',
      'make',
      'security',
      'symfony',
    ]);
    assert.equal(groups[0]?.actions[0]?.command, 'php bin/console cache:clear');
    assert.equal(groups[1]?.actions[0]?.command, 'php bin/console doctrine:database:create');
  });

  it('disables, merges built-in overrides, and appends custom groups from the workspace config', () => {
    const groups = resolveActionGroups({
      cache: {
        enabled: false,
      },
      symfony: {
        color: 'charts.yellow',
        actions: [
          {
            label: 'Restart server',
            command: 'symfony server:stop;symfony server:start',
          },
        ],
      },
      project: {
        title: 'Project',
        color: 'terminal.ansiBlue',
        actions: [
          {
            label: 'Composer install',
            command: 'composer install',
          },
        ],
      },
    });

    assert.deepEqual(groups.map((group) => group.key), [
      'doctrine',
      'make',
      'security',
      'symfony',
      'project',
    ]);
    const symfonyGroup = groups.find((group) => group.key === 'symfony');

    assert.equal(symfonyGroup?.title, 'Symfony');
    assert.equal(symfonyGroup?.description, 'Symfony CLI server commands');
    assert.equal(symfonyGroup?.icon, 'server-process');
    assert.equal(symfonyGroup?.color, 'charts.yellow');
    assert.equal(symfonyGroup?.actions[0]?.label, 'Restart server');
    assert.equal(groups.find((group) => group.key === 'project')?.title, 'Project');
  });

  it('keeps default fields when only one built-in property is overridden', () => {
    const groups = resolveActionGroups({
      symfony: {
        color: 'charts.yellow',
      },
    });
    const symfonyGroup = groups.find((group) => group.key === 'symfony');

    assert.ok(symfonyGroup);
    assert.equal(symfonyGroup.title, 'Symfony');
    assert.equal(symfonyGroup.description, 'Symfony CLI server commands');
    assert.equal(symfonyGroup.icon, 'server-process');
    assert.equal(symfonyGroup.color, 'charts.yellow');
    assert.deepEqual(symfonyGroup.actions.map((action) => action.label), ['Stop server', 'Start server']);
  });

  it('validates colors and normalizes codicon names', () => {
    assert.equal(isThemeColorId('charts.purple'), true);
    assert.equal(isThemeColorId(' terminal.ansiBlue '), true);
    assert.equal(isThemeColorId(''), false);
    assert.equal(normalizeIconName('$(server-process)'), 'server-process');
    assert.equal(normalizeIconName(' server-process '), 'server-process');
  });

  it('exposes the default workspace actions configuration', () => {
    const config = buildDefaultActionsConfiguration();

    assert.equal(config.cache?.title, 'Cache');
    assert.equal(config.symfony?.actions?.[0]?.label, 'Stop server');
    assert.equal(config.doctrine?.actions?.[0]?.command, 'php bin/console doctrine:database:create');
  });
});
