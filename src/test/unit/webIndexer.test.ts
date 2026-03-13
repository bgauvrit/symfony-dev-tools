import * as assert from 'node:assert/strict';
import * as path from 'node:path';

import { scanSymfonyWebWorkspace } from '../../features/web/indexer';

describe('Symfony web indexer', () => {
  const fixtureRoot = path.resolve(__dirname, '../../../test-fixtures/workspace/project');

  it('extracts route params, template bindings, form bindings, and EasyAdmin themes', async () => {
    const index = await scanSymfonyWebWorkspace(fixtureRoot);
    const productRoute = index.routes.find((route) => route.name === 'app_product_show_locale');
    const registerTemplate = index.templateBindings.find(
      (binding) => binding.templatePath === 'account/auth/register.html.twig',
    );
    const registerFormBinding = index.formBindings.find(
      (binding) => binding.templatePath === 'account/auth/register.html.twig' && binding.formVariable === 'registerForm',
    );
    const optionChoiceTheme = index.themeBindings.find(
      (binding) => binding.themePath === 'admin/form/option_choice_theme.html.twig',
    );

    assert.ok(productRoute);
    assert.deepEqual(productRoute?.requiredParams, ['_locale', 'slug']);
    assert.deepEqual(productRoute?.optionalParams, ['page']);
    assert.equal(productRoute?.localizedPaths.fr, '/{_locale}/produits/{slug}/{page}');
    assert.equal(productRoute?.localizedPaths.en, '/{_locale}/products/{slug}/{page}');

    assert.ok(registerTemplate);
    assert.equal(registerTemplate?.controllerClass, 'App\\Controller\\Accounts\\RegisterController');

    assert.ok(registerFormBinding);
    assert.equal(registerFormBinding?.formTypeClass, 'App\\Form\\Accounts\\RegisterUserType');
    assert.deepEqual(
      registerFormBinding?.fieldDefinitions.map((field) => field.name).sort((left, right) => left.localeCompare(right)),
      ['email', 'firstName'],
    );

    assert.ok(optionChoiceTheme);
    assert.equal(optionChoiceTheme?.controllerClass, 'App\\Controller\\Admin\\Options\\OptionChoiceCrudController');
  });
});
