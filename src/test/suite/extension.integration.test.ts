import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import * as vscode from 'vscode';

import type { SymfonyDoctrineToolsApi } from '../../api';
import { COMMANDS } from '../../constants';

describe('Extension host integration', () => {
  let extensionApi: SymfonyDoctrineToolsApi;
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const generatedTwigTemplatePath = path.join(workspaceRoot, 'templates', 'catalog', '_auto_test.html.twig');
  const generatedIcuTemplatePath = path.join(workspaceRoot, 'templates', 'cart', '_translation_icu_probe.html.twig');
  const generatedDynamicTwigPath = path.join(workspaceRoot, 'templates', 'faq', '_dynamic_probe.html.twig');
  const generatedIcuFrenchTranslationsPath = path.join(workspaceRoot, 'translations', 'messages+intl-icu.fr.yaml');
  const generatedIcuEnglishTranslationsPath = path.join(workspaceRoot, 'translations', 'messages+intl-icu.en.yaml');
  const generatedComputedTwigTemplatePath = path.join(workspaceRoot, 'templates', 'faq', '_computed_probe.html.twig');
  const generatedComputedFrenchTranslationsPath = path.join(workspaceRoot, 'translations', 'faq_probe.fr.yaml');
  const generatedComputedEnglishTranslationsPath = path.join(workspaceRoot, 'translations', 'faq_probe.en.yaml');
  const generatedOrderedTwigTemplatePath = path.join(workspaceRoot, 'templates', 'ordered', 'index.html.twig');
  const generatedOrderedTranslationsPath = path.join(workspaceRoot, 'translations', 'ordered.en.yaml');
  const generatedCategoryTranslationsPath = path.join(workspaceRoot, 'translations', 'category_probe.en.yaml');
  const generatedPeerFrenchTranslationsPath = path.join(workspaceRoot, 'translations', 'peer_nav.fr.yaml');
  const generatedPeerEnglishTranslationsPath = path.join(workspaceRoot, 'translations', 'peer_nav.en.yaml');
  const generatedCoalesceTwigTemplatePath = path.join(workspaceRoot, 'templates', 'products', '_coalesce_probe.html.twig');
  const generatedIgnoredValidatorsTranslationsPath = path.join(workspaceRoot, 'translations', 'validators.fr.yaml');
  const generatedIgnoredValidatorsUsagePath = path.join(workspaceRoot, 'templates', 'validation', '_ignored_probe.html.twig');
  const generatedMissingAnnotationTwigPath = path.join(workspaceRoot, 'templates', 'catalog', '_ignore_missing_probe.html.twig');
  const generatedRouteCompletionTwigPath = path.join(workspaceRoot, 'templates', 'catalog', '_route_completion_probe.html.twig');
  const restorableFiles = [
    path.join(workspaceRoot, 'translations', 'messages.fr.yaml'),
    path.join(workspaceRoot, 'translations', 'messages.en.yaml'),
    path.join(workspaceRoot, 'src', 'Controller', 'Catalog', 'TranslationProbeController.php'),
  ];
  const originalFileContents = new Map<string, string>();

  before(async () => {
    const extension = vscode.extensions.getExtension<SymfonyDoctrineToolsApi>(
      'develop-it.symfony-dev-tools',
    );

    assert.ok(extension, 'The extension should be available in the test host.');
    extensionApi = await extension.activate();

    for (const filePath of restorableFiles) {
      originalFileContents.set(filePath, await fs.readFile(filePath, 'utf8'));
    }
  });

  afterEach(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');

    for (const [filePath, originalText] of originalFileContents.entries()) {
      await fs.writeFile(filePath, originalText, 'utf8');
    }

    await fs.rm(generatedTwigTemplatePath, { force: true });
    await fs.rm(generatedIcuTemplatePath, { force: true });
    await fs.rm(generatedDynamicTwigPath, { force: true });
    await fs.rm(generatedIcuFrenchTranslationsPath, { force: true });
    await fs.rm(generatedIcuEnglishTranslationsPath, { force: true });
    await fs.rm(generatedComputedTwigTemplatePath, { force: true });
    await fs.rm(generatedComputedFrenchTranslationsPath, { force: true });
    await fs.rm(generatedComputedEnglishTranslationsPath, { force: true });
    await fs.rm(generatedOrderedTwigTemplatePath, { force: true });
    await fs.rm(generatedOrderedTranslationsPath, { force: true });
    await fs.rm(generatedCategoryTranslationsPath, { force: true });
    await fs.rm(generatedPeerFrenchTranslationsPath, { force: true });
    await fs.rm(generatedPeerEnglishTranslationsPath, { force: true });
    await fs.rm(generatedCoalesceTwigTemplatePath, { force: true });
    await fs.rm(generatedIgnoredValidatorsTranslationsPath, { force: true });
    await fs.rm(generatedIgnoredValidatorsUsagePath, { force: true });
    await fs.rm(generatedMissingAnnotationTwigPath, { force: true });
    await fs.rm(generatedRouteCompletionTwigPath, { force: true });
    await vscode.workspace
      .getConfiguration('symfonyDevTools')
      .update('ignoredTranslationFiles', [], vscode.ConfigurationTarget.Workspace);
    await extensionApi.scanTranslations();
  });

  it('loads actions and promotes pinned tasks', async () => {
    await vscode.workspace
      .getConfiguration('symfonyDevTools')
      .update('pinnedTasks', ['Run server', 'Controller'], vscode.ConfigurationTarget.Workspace);

    await wait(100);

    const actions = await extensionApi.getActionsSnapshot();
    const labels = actions.map((action) => action.label);

    assert.deepEqual(labels.slice(0, 2), [
      'Run server',
      'Controller',
    ]);
    assert.equal(labels.includes('Open diagram'), false);
    assert.equal(labels.includes('Sync translations'), false);
  });

  it('groups related workspace tasks by command family', async () => {
    const actions = await extensionApi.getActionsSnapshot();
    const labels = actions.map((action) => action.label);
    const npmRunGroup = actions.find((action) => action.label === 'npm run');
    const makeGroup = actions.find((action) => action.label === 'php bin/console make');

    assert.equal(labels.includes('npm run'), true);
    assert.equal(labels.includes('php bin/console make'), true);
    assert.equal(npmRunGroup?.iconColor, 'charts.green');
    assert.equal(makeGroup?.iconColor, 'charts.blue');
    assert.equal(labels.includes('Webpack'), false);
    assert.equal(labels.includes('Webpack (build)'), false);
    assert.equal(
      actions.some((action) => action.children?.some((child) => child.label === 'Webpack (build)' || child.label === 'Webpack')),
      false,
    );
  });

  it('executes an existing workspace task and rejects a missing one', async () => {
    const taskStarted = onceTaskStarted('Run server');

    await vscode.commands.executeCommand(COMMANDS.runTask, {
      taskLabel: 'Run server',
    });

    await taskStarted;

    const actions = await extensionApi.getActionsSnapshot();
    const symfonyGroup = actions.find((action) => action.label === 'symfony');
    const lastUsed = symfonyGroup?.children?.[0];

    assert.equal(lastUsed?.label, 'Run server');
    assert.equal(lastUsed?.description, 'Last used');

    await assert.rejects(
      () =>
        Promise.resolve(
          vscode.commands.executeCommand(COMMANDS.runTask, {
            taskLabel: 'Missing task',
          }),
        ),
      /introuvable/,
    );
  });

  it('opens the diagram, renders a Graphviz SVG and refreshes it manually', async () => {
    await vscode.commands.executeCommand(COMMANDS.openEntityDiagram);

    await waitFor(() => {
      const state = extensionApi.getDiagramState();

      return state.isOpen && Boolean(state.model) && state.hasSvg;
    });

    const firstGeneratedAt = extensionApi.getDiagramState().model?.generatedAt;

    await vscode.commands.executeCommand(COMMANDS.refreshEntityDiagram);

    await waitFor(() => {
      const state = extensionApi.getDiagramState();
      const nextGeneratedAt = state.model?.generatedAt;

      return Boolean(firstGeneratedAt && nextGeneratedAt && nextGeneratedAt !== firstGeneratedAt && state.hasSvg);
    });
  });

  it('updates diagram filters and preserves them across refreshes', async () => {
    await extensionApi.updateDiagramFilters({
      includedDomains: ['Catalog'],
      query: 'Product',
    });

    await waitFor(() => {
      const state = extensionApi.getDiagramState();

      return (
        state.filterState.query === 'Product' &&
        state.summary?.visibleEntities === 2 &&
        state.visibleEntityIds.every((entityId) => entityId.startsWith('App\\Entity\\Catalog\\'))
      );
    });

    await vscode.commands.executeCommand(COMMANDS.refreshEntityDiagram);

    await waitFor(() => {
      const state = extensionApi.getDiagramState();

      return (
        state.filterState.query === 'Product' &&
        assertSelectedDomains(state.filterState.includedDomains, ['Catalog']) &&
        state.summary?.visibleRelations === 1
      );
    });
  });

  it('auto-refreshes on entity edits and opens the mapped PHP file', async () => {
    const productPath = path.join(workspaceRoot, 'src', 'Entity', 'Catalog', 'Product.php');
    const document = await vscode.workspace.openTextDocument(productPath);
    const editor = await vscode.window.showTextDocument(document, { preview: false });
    const beforeRefresh = extensionApi.getDiagramState().model?.generatedAt;
    const insertPosition = document.positionAt(document.getText().lastIndexOf('}'));
    const marker = `\n    // refresh-${Date.now()}\n`;

    await editor.edit((editBuilder) => {
      editBuilder.insert(insertPosition, marker);
    });

    await waitFor(() => {
      const state = extensionApi.getDiagramState();
      const nextGeneratedAt = state.model?.generatedAt;

      return Boolean(beforeRefresh && nextGeneratedAt && nextGeneratedAt !== beforeRefresh && state.hasSvg);
    });

    const stateAfterRefresh = extensionApi.getDiagramState();

    assert.equal(stateAfterRefresh.filterState.query, 'Product');
    assert.deepEqual(stateAfterRefresh.filterState.includedDomains, ['Catalog']);

    await vscode.commands.executeCommand(COMMANDS.openEntityFile, {
      entityId: 'App\\Entity\\Catalog\\Product',
    });

    assert.equal(
      vscode.window.activeTextEditor?.document.uri.fsPath.endsWith(path.join('Catalog', 'Product.php')),
      true,
    );

    await vscode.commands.executeCommand('workbench.action.files.revert');
  });

  it('scans translations and applies missing, unused, and dynamic quick fixes', async () => {
    await extensionApi.scanTranslations();

    await waitFor(() => extensionApi.getTranslationState().summary.issueCount === 4);

    const initialState = extensionApi.getTranslationState();

    assert.equal(initialState.summary.missingCount, 2);
    assert.equal(initialState.summary.unusedCount, 1);
    assert.equal(initialState.summary.dynamicCount, 1);
    assert.equal(initialState.summary.parseErrorCount, 0);

    const dynamicIssue = initialState.issues.find((issue) => issue.kind === 'dynamic');
    const missingIssue = initialState.issues.find((issue) => issue.kind === 'missing');
    const unusedIssue = initialState.issues.find((issue) => issue.kind === 'unused');

    assert.ok(dynamicIssue);
    assert.ok(missingIssue);
    assert.ok(unusedIssue);

    await vscode.commands.executeCommand(COMMANDS.applyTranslationFix, dynamicIssue?.id);

    await waitFor(() => extensionApi.getTranslationState().summary.dynamicCount === 0);

    const controllerPath = path.join(workspaceRoot, 'src', 'Controller', 'Catalog', 'TranslationProbeController.php');
    const annotatedController = await fs.readFile(controllerPath, 'utf8');

    assert.equal(
      annotatedController.includes('// symfony-dev-tools:mark-used messages:*'),
      true,
    );

    await vscode.commands.executeCommand(COMMANDS.applyTranslationFix, missingIssue?.id);

    await waitFor(() => extensionApi.getTranslationState().summary.missingCount === 0);

    const englishTranslations = await fs.readFile(path.join(workspaceRoot, 'translations', 'messages.en.yaml'), 'utf8');
    const todoIssue = extensionApi
      .getTranslationState()
      .issues.find((issue) => issue.kind === 'todo' && issue.key === 'catalog.product.missing' && issue.locale === 'en');

    assert.equal(englishTranslations.includes('missing: "" # symfony-dev-tools:todo'), true);
    assert.ok(todoIssue);
    assert.equal(todoIssue?.severity, 'error');

    await vscode.commands.executeCommand(COMMANDS.applyTranslationFix, unusedIssue?.id);

    await waitFor(() => extensionApi.getTranslationState().summary.unusedCount === 0);

    const frenchTranslations = await fs.readFile(path.join(workspaceRoot, 'translations', 'messages.fr.yaml'), 'utf8');

    assert.equal(frenchTranslations.includes('only_here'), false);
  });

  it('inserts a Twig partial template from the active editor context', async () => {
    await fs.mkdir(path.dirname(generatedTwigTemplatePath), { recursive: true });
    await fs.writeFile(generatedTwigTemplatePath, '', 'utf8');

    const document = await vscode.workspace.openTextDocument(generatedTwigTemplatePath);

    await vscode.window.showTextDocument(document, { preview: false });
    await vscode.commands.executeCommand(COMMANDS.insertTemplate);

    const renderedTemplate = await fs.readFile(generatedTwigTemplatePath, 'utf8');

    assert.equal(renderedTemplate.includes("<h2>{{ 'title._'|trans }}</h2>"), true);
    assert.equal(renderedTemplate.includes("{% extends '"), false);
  });

  it('handles ICU twig filter parameters and keeps dynamic issue ids unique', async () => {
    await fs.mkdir(path.dirname(generatedIcuTemplatePath), { recursive: true });
    await fs.mkdir(path.dirname(generatedDynamicTwigPath), { recursive: true });
    await fs.mkdir(path.dirname(generatedIcuFrenchTranslationsPath), { recursive: true });
    await fs.writeFile(
      generatedIcuFrenchTranslationsPath,
      [
        'cart:',
        '    items:',
        '        count:',
        '            _: "{count, plural, one {# article} other {# articles}}"',
        '',
      ].join('\n'),
      'utf8',
    );
    await fs.writeFile(
      generatedIcuEnglishTranslationsPath,
      [
        'cart:',
        '    items:',
        '        count:',
        '            _: "{count, plural, one {# item} other {# items}}"',
        '',
      ].join('\n'),
      'utf8',
    );
    await fs.writeFile(
      generatedIcuTemplatePath,
      "<p data-cart-total-quantity>{{ 'cart.items.count._' | trans({'{count}': cart.totalQuantity}) }}</p>\n",
      'utf8',
    );
    await fs.writeFile(
      generatedDynamicTwigPath,
      [
        "{{ trans(questionKey) }}",
        "{{ trans(questionKey) }}",
        '',
      ].join('\n'),
      'utf8',
    );

    await extensionApi.scanTranslations();

    await waitFor(() => extensionApi.getTranslationState().summary.issueCount >= 6);

    const translationState = extensionApi.getTranslationState();
    const cartCountIssues = translationState.issues.filter((issue) => issue.key === 'cart.items.count._');
    const dynamicIssues = translationState.issues.filter(
      (issue) => issue.kind === 'dynamic' && issue.sourceFilePath === generatedDynamicTwigPath,
    );
    const dynamicIssueIds = new Set(dynamicIssues.map((issue) => issue.id));

    assert.equal(
      cartCountIssues.some((issue) => issue.kind === 'missing' || issue.kind === 'unused'),
      false,
    );
    assert.equal(dynamicIssues.length, 2);
    assert.equal(dynamicIssueIds.size, dynamicIssues.length);
  });

  it('resolves computed FAQ-like twig translation keys without reporting them as unused', async () => {
    await fs.mkdir(path.dirname(generatedComputedTwigTemplatePath), { recursive: true });
    await fs.mkdir(path.dirname(generatedComputedFrenchTranslationsPath), { recursive: true });
    await fs.writeFile(
      generatedComputedFrenchTranslationsPath,
      [
        '_faq:',
        '    section_1:',
        '        title: "Section 1"',
        '        question_1:',
        '            title: "Question 1.1"',
        '        question_2:',
        '            title: "Question 1.2"',
        '    section_2:',
        '        title: "Section 2"',
        '        question_1:',
        '            title: "Question 2.1"',
        '',
      ].join('\n'),
      'utf8',
    );
    await fs.writeFile(
      generatedComputedEnglishTranslationsPath,
      [
        '_faq:',
        '    section_1:',
        '        title: "Section 1"',
        '        question_1:',
        '            title: "Question 1.1"',
        '        question_2:',
        '            title: "Question 1.2"',
        '    section_2:',
        '        title: "Section 2"',
        '        question_1:',
        '            title: "Question 2.1"',
        '',
      ].join('\n'),
      'utf8',
    );
    await fs.writeFile(
      generatedComputedTwigTemplatePath,
      [
        "{% set questionsBySection = { 1: 2, 2: 1 } %}",
        "{% for section in 1..2 %}",
        "    {% set sectionBase = '_faq.section_' ~ section %}",
        "    <h2>{{ (sectionBase ~ '.title') | trans({}, 'faq_probe') }}</h2>",
        "    {% for question in 1..questionsBySection[section] %}",
        "        {% set questionBase = sectionBase ~ '.question_' ~ question %}",
        "        <h3>{{ (questionBase ~ '.title') | trans({}, 'faq_probe') | raw }}</h3>",
        '    {% endfor %}',
        '{% endfor %}',
        '',
      ].join('\n'),
      'utf8',
    );

    await extensionApi.scanTranslations();

    await waitFor(() =>
      extensionApi
        .getTranslationState()
        .issues.every((issue) => issue.sourceFilePath !== generatedComputedTwigTemplatePath),
    );

    const computedIssues = extensionApi
      .getTranslationState()
      .issues.filter((issue) => issue.domain === 'faq_probe' || issue.sourceFilePath === generatedComputedTwigTemplatePath);

    assert.equal(computedIssues.length, 0);
  });

  it('inserts missing translations alphabetically and keeps underscore-prefixed keys at the end', async () => {
    await fs.mkdir(path.dirname(generatedOrderedTwigTemplatePath), { recursive: true });
    await fs.mkdir(path.dirname(generatedOrderedTranslationsPath), { recursive: true });
    await fs.writeFile(
      generatedOrderedTranslationsPath,
      [
        'beta: "Beta"',
        'omega: "Omega"',
        '',
      ].join('\n'),
      'utf8',
    );
    await fs.writeFile(
      generatedOrderedTwigTemplatePath,
      [
        "{{ 'alpha' | trans({}, 'ordered') }}",
        "{{ '_tail' | trans({}, 'ordered') }}",
        '',
      ].join('\n'),
      'utf8',
    );

    await extensionApi.scanTranslations();

    await waitFor(() =>
      extensionApi
        .getTranslationState()
        .issues.filter((issue) => issue.domain === 'ordered' && issue.kind === 'missing').length === 2,
    );

    const orderedIssues = extensionApi
      .getTranslationState()
      .issues.filter((issue) => issue.domain === 'ordered' && issue.kind === 'missing');
    const alphaIssue = orderedIssues.find((issue) => issue.key === 'alpha');
    const tailIssue = orderedIssues.find((issue) => issue.key === '_tail');

    assert.ok(alphaIssue);
    assert.ok(tailIssue);

    await vscode.commands.executeCommand(COMMANDS.applyTranslationFix, alphaIssue?.id);
    await vscode.commands.executeCommand(COMMANDS.applyTranslationFix, tailIssue?.id);

    await waitFor(() =>
      extensionApi
        .getTranslationState()
        .issues.every((issue) => !(issue.domain === 'ordered' && issue.kind === 'missing')),
    );

    const orderedTranslations = await fs.readFile(generatedOrderedTranslationsPath, 'utf8');
    const alphaIndex = orderedTranslations.indexOf('alpha: ""');
    const betaIndex = orderedTranslations.indexOf('beta: "Beta"');
    const omegaIndex = orderedTranslations.indexOf('omega: "Omega"');
    const tailIndex = orderedTranslations.indexOf('_tail: ""');

    assert.equal(alphaIndex >= 0, true);
    assert.equal(tailIndex >= 0, true);
    assert.equal(alphaIndex < betaIndex, true);
    assert.equal(tailIndex > omegaIndex, true);
    assert.equal(orderedTranslations.includes('alpha: "" # symfony-dev-tools:todo'), true);
    assert.equal(orderedTranslations.includes('_tail: "" # symfony-dev-tools:todo'), true);
  });

  it('marks unused category-style translations as warnings', async () => {
    await fs.mkdir(path.dirname(generatedCategoryTranslationsPath), { recursive: true });
    await fs.writeFile(
      generatedCategoryTranslationsPath,
      [
        'roles:',
        '    _: ""',
        '',
      ].join('\n'),
      'utf8',
    );

    await extensionApi.scanTranslations();

    await waitFor(() =>
      extensionApi
        .getTranslationState()
        .issues.some((issue) => issue.key === 'roles._' && issue.domain === 'category_probe'),
    );

    const categoryIssue = extensionApi
      .getTranslationState()
      .issues.find((issue) => issue.key === 'roles._' && issue.domain === 'category_probe');

    assert.ok(categoryIssue);
    assert.equal(categoryIssue?.kind, 'unused');
    assert.equal(categoryIssue?.severity, 'warning');
  });

  it('detects static twig translations inside null coalescing expressions', async () => {
    await fs.mkdir(path.dirname(generatedCoalesceTwigTemplatePath), { recursive: true });
    await fs.writeFile(
      generatedCoalesceTwigTemplatePath,
      [
        "<h1>{{ selectedCategoryName ?? ('_products_page.title._' | trans) }}</h1>",
        '',
      ].join('\n'),
      'utf8',
    );

    await extensionApi.scanTranslations();

    await waitFor(() =>
      extensionApi
        .getTranslationState()
        .issues.every(
          (issue) =>
            !(
              issue.sourceFilePath === generatedCoalesceTwigTemplatePath &&
              (issue.kind === 'dynamic' || issue.key === '_products_page.title._')
            ),
        ),
    );

    const coalesceIssues = extensionApi
      .getTranslationState()
      .issues.filter((issue) => issue.sourceFilePath === generatedCoalesceTwigTemplatePath);

    assert.equal(coalesceIssues.length, 0);
  });

  it('can ignore missing translations with an explicit annotation quick fix', async () => {
    await fs.mkdir(path.dirname(generatedMissingAnnotationTwigPath), { recursive: true });
    await fs.writeFile(
      generatedMissingAnnotationTwigPath,
      [
        "{{ 'catalog.product.intentional_gap'|trans }}",
        '',
      ].join('\n'),
      'utf8',
    );

    await extensionApi.scanTranslations();

    await waitFor(() =>
      extensionApi
        .getTranslationState()
        .issues.some(
          (issue) =>
            issue.sourceFilePath === generatedMissingAnnotationTwigPath &&
            issue.kind === 'missing' &&
            issue.key === 'catalog.product.intentional_gap',
        ),
    );

    const missingIssue = extensionApi
      .getTranslationState()
      .issues.find(
        (issue) =>
          issue.sourceFilePath === generatedMissingAnnotationTwigPath &&
          issue.kind === 'missing' &&
          issue.key === 'catalog.product.intentional_gap',
      );

    assert.ok(missingIssue);

    await vscode.commands.executeCommand(COMMANDS.applyTranslationAnnotationFix, missingIssue?.id);

    await waitFor(() =>
      extensionApi
        .getTranslationState()
        .issues.every(
          (issue) =>
            !(
              issue.sourceFilePath === generatedMissingAnnotationTwigPath &&
              issue.kind === 'missing' &&
              issue.key === 'catalog.product.intentional_gap'
            ),
        ),
    );

    const annotatedTemplate = await fs.readFile(generatedMissingAnnotationTwigPath, 'utf8');

    assert.equal(
      annotatedTemplate.includes(
        "{# symfony-dev-tools:ignore-missing messages:catalog.product.intentional_gap #}",
      ),
      true,
    );
  });

  it('ignores configured translation files during audit and sync', async () => {
    await fs.mkdir(path.dirname(generatedIgnoredValidatorsTranslationsPath), { recursive: true });
    await fs.mkdir(path.dirname(generatedIgnoredValidatorsUsagePath), { recursive: true });
    await fs.writeFile(
      generatedIgnoredValidatorsTranslationsPath,
      [
        'required: "" # symfony-dev-tools:todo',
        'orphan: "Unused validator"',
        '',
      ].join('\n'),
      'utf8',
    );
    await fs.writeFile(
      generatedIgnoredValidatorsUsagePath,
      [
        "{{ 'required' | trans({}, 'validators') }}",
        "{{ 'missing_key' | trans({}, 'validators') }}",
        '',
      ].join('\n'),
      'utf8',
    );
    await vscode.workspace
      .getConfiguration('symfonyDevTools')
      .update('ignoredTranslationFiles', ['translations/validators*.yaml'], vscode.ConfigurationTarget.Workspace);

    await extensionApi.scanTranslations();

    await waitFor(() =>
      extensionApi.getTranslationState().issues.every(
        (issue) =>
          issue.sourceFilePath !== generatedIgnoredValidatorsTranslationsPath &&
          issue.sourceFilePath !== generatedIgnoredValidatorsUsagePath &&
          issue.domain !== 'validators',
      ),
    );

    const validatorIssues = extensionApi
      .getTranslationState()
      .issues.filter(
        (issue) =>
          issue.sourceFilePath === generatedIgnoredValidatorsTranslationsPath ||
          issue.sourceFilePath === generatedIgnoredValidatorsUsagePath ||
          issue.domain === 'validators',
      );

    assert.equal(validatorIssues.length, 0);
  });

  it('offers one-click navigation to the same translation key in another locale', async () => {
    await fs.mkdir(path.dirname(generatedPeerFrenchTranslationsPath), { recursive: true });
    await fs.writeFile(
      generatedPeerFrenchTranslationsPath,
      [
        'roles:',
        '    _: "Roles FR"',
        '',
      ].join('\n'),
      'utf8',
    );
    await fs.writeFile(
      generatedPeerEnglishTranslationsPath,
      [
        'roles:',
        '    _: "Roles EN"',
        '',
      ].join('\n'),
      'utf8',
    );

    await extensionApi.scanTranslations();

    const document = await vscode.workspace.openTextDocument(generatedPeerFrenchTranslationsPath);

    await vscode.window.showTextDocument(document, { preview: false });

    await waitFor(async () => {
      const codeLenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
        'vscode.executeCodeLensProvider',
        document.uri,
      );

      return Boolean(codeLenses?.some((codeLens) => codeLens.command?.title === 'Open en'));
    });

    const codeLenses =
      (await vscode.commands.executeCommand<vscode.CodeLens[]>(
        'vscode.executeCodeLensProvider',
        document.uri,
      )) ?? [];
    const openEnglishCodeLens = codeLenses.find((codeLens) => codeLens.command?.title === 'Open en');

    assert.ok(openEnglishCodeLens?.command);

    await vscode.commands.executeCommand(
      openEnglishCodeLens.command.command,
      ...(openEnglishCodeLens.command.arguments ?? []),
    );

    assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, generatedPeerEnglishTranslationsPath);
  });

  it('supports ctrl+click from Twig translation usages to the reference locale definition', async () => {
    await extensionApi.scanTranslations();

    const twigPath = path.join(workspaceRoot, 'templates', 'catalog', 'probe', 'index.html.twig');
    const document = await vscode.workspace.openTextDocument(twigPath);
    const keyOffset = document.getText().indexOf('catalog.product.title');

    assert.notEqual(keyOffset, -1);

    const definitions =
      (await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
        'vscode.executeDefinitionProvider',
        document.uri,
        document.positionAt(keyOffset + 3),
      )) ?? [];

    assert.equal(definitions.length > 0, true);
    assert.equal(
      getDefinitionTargetPath(definitions[0]),
      path.join(workspaceRoot, 'translations', 'messages.fr.yaml'),
    );
    assert.equal(getOriginSelectionText(document, definitions[0]), "'catalog.product.title'");
  });

  it('supports ctrl+click from PHP translation usages to the reference locale definition', async () => {
    await extensionApi.scanTranslations();

    const phpPath = path.join(workspaceRoot, 'src', 'Controller', 'Catalog', 'TranslationProbeController.php');
    const document = await vscode.workspace.openTextDocument(phpPath);
    const keyOffset = document.getText().indexOf('catalog.product.title');

    assert.notEqual(keyOffset, -1);

    const definitions =
      (await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
        'vscode.executeDefinitionProvider',
        document.uri,
        document.positionAt(keyOffset + 3),
      )) ?? [];

    assert.equal(definitions.length > 0, true);
    assert.equal(
      getDefinitionTargetPath(definitions[0]),
      path.join(workspaceRoot, 'translations', 'messages.fr.yaml'),
    );
  });

  it('supports ctrl+click from Twig path() usages to the route attribute', async () => {
    const twigPath = path.join(workspaceRoot, 'templates', 'catalog', 'product', 'show.html.twig');
    const document = await vscode.workspace.openTextDocument(twigPath);
    const keyOffset = document.getText().indexOf('app_product_show_locale');

    assert.notEqual(keyOffset, -1);

    const definitions =
      (await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
        'vscode.executeDefinitionProvider',
        document.uri,
        document.positionAt(keyOffset + 3),
      )) ?? [];

    assert.equal(definitions.length > 0, true);
    assert.equal(
      getDefinitionTargetPath(definitions[0]),
      path.join(workspaceRoot, 'src', 'Controller', 'Catalog', 'ProductController.php'),
    );
  });

  it('supports ctrl+click from PHP route helpers to the route attribute', async () => {
    const phpPath = path.join(workspaceRoot, 'src', 'Controller', 'Accounts', 'RegisterController.php');
    const document = await vscode.workspace.openTextDocument(phpPath);
    const keyOffset = document.getText().indexOf('app_product_show_locale');

    assert.notEqual(keyOffset, -1);

    const definitions =
      (await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
        'vscode.executeDefinitionProvider',
        document.uri,
        document.positionAt(keyOffset + 3),
      )) ?? [];

    assert.equal(definitions.length > 0, true);
    assert.equal(
      getDefinitionTargetPath(definitions[0]),
      path.join(workspaceRoot, 'src', 'Controller', 'Catalog', 'ProductController.php'),
    );
  });

  it('supports ctrl+click from PHP render() and setFormThemes() template strings to Twig files', async () => {
    const registerControllerPath = path.join(workspaceRoot, 'src', 'Controller', 'Accounts', 'RegisterController.php');
    const registerControllerDocument = await vscode.workspace.openTextDocument(registerControllerPath);
    const renderOffset = registerControllerDocument.getText().indexOf('account/auth/register.html.twig');

    assert.notEqual(renderOffset, -1);

    const renderDefinitions =
      (await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
        'vscode.executeDefinitionProvider',
        registerControllerDocument.uri,
        registerControllerDocument.positionAt(renderOffset + 3),
      )) ?? [];

    assert.equal(renderDefinitions.length > 0, true);
    assert.equal(
      getDefinitionTargetPath(renderDefinitions[0]),
      path.join(workspaceRoot, 'templates', 'account', 'auth', 'register.html.twig'),
    );
    assert.equal(getOriginSelectionLength(renderDefinitions[0]), 'account/auth/register.html.twig'.length);

    const crudControllerPath = path.join(workspaceRoot, 'src', 'Controller', 'Admin', 'Options', 'OptionChoiceCrudController.php');
    const crudControllerDocument = await vscode.workspace.openTextDocument(crudControllerPath);
    const themeOffset = crudControllerDocument.getText().indexOf('admin/form/option_choice_theme.html.twig');

    assert.notEqual(themeOffset, -1);

    const themeDefinitions =
      (await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
        'vscode.executeDefinitionProvider',
        crudControllerDocument.uri,
        crudControllerDocument.positionAt(themeOffset + 3),
      )) ?? [];

    assert.equal(themeDefinitions.length > 0, true);
    assert.equal(
      getDefinitionTargetPath(themeDefinitions[0]),
      path.join(workspaceRoot, 'templates', 'admin', 'form', 'option_choice_theme.html.twig'),
    );
  });

  it('adds controller and form-type CodeLens entries to Twig templates', async () => {
    const twigPath = path.join(workspaceRoot, 'templates', 'account', 'auth', 'register.html.twig');
    const document = await vscode.workspace.openTextDocument(twigPath);
    const codeLenses =
      (await vscode.commands.executeCommand<vscode.CodeLens[]>(
        'vscode.executeCodeLensProvider',
        document.uri,
      )) ?? [];
    const openControllerCodeLens = codeLenses.find((codeLens) => codeLens.command?.title === 'Open controller');
    const openFormTypeCodeLens = codeLenses.find((codeLens) => codeLens.command?.title === 'Open form type');

    assert.ok(openControllerCodeLens?.command);
    assert.ok(openFormTypeCodeLens?.command);

    await vscode.commands.executeCommand(
      openFormTypeCodeLens.command.command,
      ...(openFormTypeCodeLens.command.arguments ?? []),
    );

    assert.equal(
      vscode.window.activeTextEditor?.document.uri.fsPath,
      path.join(workspaceRoot, 'src', 'Form', 'Accounts', 'RegisterUserType.php'),
    );
  });

  it('supports ctrl+click from Twig form variables to the matching FormType field', async () => {
    const twigPath = path.join(workspaceRoot, 'templates', 'account', 'auth', 'register.html.twig');
    const document = await vscode.workspace.openTextDocument(twigPath);
    const keyOffset = document.getText().indexOf('registerForm.email');

    assert.notEqual(keyOffset, -1);

    const definitions =
      (await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
        'vscode.executeDefinitionProvider',
        document.uri,
        document.positionAt(keyOffset + 'registerForm.'.length + 2),
      )) ?? [];

    assert.equal(definitions.length > 0, true);
    assert.equal(
      getDefinitionTargetPath(definitions[0]),
      path.join(workspaceRoot, 'src', 'Form', 'Accounts', 'RegisterUserType.php'),
    );
  });

  it('adds a CRUD CodeLens entry to EasyAdmin theme templates', async () => {
    const twigPath = path.join(workspaceRoot, 'templates', 'admin', 'form', 'option_choice_theme.html.twig');
    const document = await vscode.workspace.openTextDocument(twigPath);
    const codeLenses =
      (await vscode.commands.executeCommand<vscode.CodeLens[]>(
        'vscode.executeCodeLensProvider',
        document.uri,
      )) ?? [];
    const openCrudCodeLens = codeLenses.find((codeLens) => codeLens.command?.title === 'Open CRUD controller');

    assert.ok(openCrudCodeLens?.command);

    await vscode.commands.executeCommand(
      openCrudCodeLens.command.command,
      ...(openCrudCodeLens.command.arguments ?? []),
    );

    assert.equal(
      vscode.window.activeTextEditor?.document.uri.fsPath,
      path.join(workspaceRoot, 'src', 'Controller', 'Admin', 'Options', 'OptionChoiceCrudController.php'),
    );
  });

  it('offers Twig path() route completions that inject required params and keep optional ones separate', async () => {
    await fs.mkdir(path.dirname(generatedRouteCompletionTwigPath), { recursive: true });
    await fs.writeFile(generatedRouteCompletionTwigPath, "{{ path('app_product_') }}\n", 'utf8');

    const routeNameDocument = await vscode.workspace.openTextDocument(generatedRouteCompletionTwigPath);
    const routeNameOffset = routeNameDocument.getText().indexOf('app_product_') + 'app_product_'.length;
    const routeNameCompletions =
      (await vscode.commands.executeCommand<vscode.CompletionList>(
        'vscode.executeCompletionItemProvider',
        routeNameDocument.uri,
        routeNameDocument.positionAt(routeNameOffset),
      )) ?? { items: [] };
    const routeItem = routeNameCompletions.items.find((item) => item.label === 'app_product_show_locale');

    assert.ok(routeItem);
    assert.equal(routeItem?.insertText instanceof vscode.SnippetString, true);
    assert.equal(
      String((routeItem?.insertText as vscode.SnippetString).value).includes("_locale: app.request.locale, slug: ${2:slug}"),
      true,
    );
    assert.equal(
      String((routeItem?.insertText as vscode.SnippetString).value).includes('page'),
      false,
    );

    await fs.writeFile(
      generatedRouteCompletionTwigPath,
      "{{ path('app_product_show_locale', { _locale: app.request.locale, slug: product.slug,  }) }}\n",
      'utf8',
    );

    const paramsDocument = await vscode.workspace.openTextDocument(generatedRouteCompletionTwigPath);
    const paramsOffset = paramsDocument.getText().indexOf(',  })') + 2;
    const paramCompletions =
      (await vscode.commands.executeCommand<vscode.CompletionList>(
        'vscode.executeCompletionItemProvider',
        paramsDocument.uri,
        paramsDocument.positionAt(paramsOffset),
      )) ?? { items: [] };
    const paramLabels = paramCompletions.items.map((item) => String(item.label));

    assert.equal(paramLabels.includes('page'), true);
    assert.equal(paramLabels.includes('_locale'), false);
    assert.equal(paramLabels.includes('slug'), false);
  });

  it('finds route references from the route attribute name across Twig and PHP', async () => {
    const controllerPath = path.join(workspaceRoot, 'src', 'Controller', 'Catalog', 'ProductController.php');
    const document = await vscode.workspace.openTextDocument(controllerPath);
    const keyOffset = document.getText().indexOf('app_product_show_locale');

    assert.notEqual(keyOffset, -1);

    const references =
      (await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeReferenceProvider',
        document.uri,
        document.positionAt(keyOffset + 3),
      )) ?? [];
    const referencePaths = new Set(references.map((reference) => reference.uri.fsPath));

    assert.equal(referencePaths.has(controllerPath), true);
    assert.equal(
      referencePaths.has(path.join(workspaceRoot, 'templates', 'catalog', 'product', 'show.html.twig')),
      true,
    );
    assert.equal(
      referencePaths.has(path.join(workspaceRoot, 'src', 'Controller', 'Accounts', 'RegisterController.php')),
      true,
    );
  });

  it('supports ctrl+click from Twig source() usages to the mapped asset file', async () => {
    const twigPath = path.join(workspaceRoot, 'templates', 'catalog', 'product', 'show.html.twig');
    const document = await vscode.workspace.openTextDocument(twigPath);
    const sourceOffset = document.getText().indexOf('@assets_images/icons/heart.svg');

    assert.notEqual(sourceOffset, -1);

    const definitions =
      (await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
        'vscode.executeDefinitionProvider',
        document.uri,
        document.positionAt(sourceOffset + 3),
      )) ?? [];

    assert.equal(definitions.length > 0, true);
    assert.equal(
      getDefinitionTargetPath(definitions[0]),
      path.join(workspaceRoot, 'assets', 'images', 'icons', 'heart.svg'),
    );
    assert.equal(getOriginSelectionLength(definitions[0]), '@assets_images/icons/heart.svg'.length);
  });

  it('supports ctrl+click from Twig asset() usages to public build assets', async () => {
    const twigPath = path.join(workspaceRoot, 'templates', 'catalog', 'product', 'show.html.twig');
    const document = await vscode.workspace.openTextDocument(twigPath);
    const assetOffset = document.getText().indexOf('build/images/logo_bg.svg');

    assert.notEqual(assetOffset, -1);

    const definitions =
      (await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
        'vscode.executeDefinitionProvider',
        document.uri,
        document.positionAt(assetOffset + 3),
      )) ?? [];

    assert.equal(definitions.length > 0, true);
    assert.equal(
      getDefinitionTargetPath(definitions[0]),
      path.join(workspaceRoot, 'assets', 'images', 'logo_bg.svg'),
    );
    assert.equal(getOriginSelectionLength(definitions[0]), 'build/images/logo_bg.svg'.length);
  });
});

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }

    await wait(100);
  }

  throw new Error(`Timed out after ${timeoutMs}ms.`);
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function onceTaskStarted(taskName: string): Promise<void> {
  return new Promise((resolve) => {
    const disposable = vscode.tasks.onDidStartTaskProcess((event) => {
      if (event.execution.task.name === taskName) {
        disposable.dispose();
        resolve();
      }
    });
  });
}

function getDefinitionTargetPath(definition: vscode.Location | vscode.LocationLink): string {
  if ('targetUri' in definition) {
    return definition.targetUri.fsPath;
  }

  return definition.uri.fsPath;
}

function getOriginSelectionLength(definition: vscode.Location | vscode.LocationLink): number {
  if ('originSelectionRange' in definition && definition.originSelectionRange) {
    return definition.originSelectionRange.end.character - definition.originSelectionRange.start.character;
  }

  return 0;
}

function getOriginSelectionText(
  document: vscode.TextDocument,
  definition: vscode.Location | vscode.LocationLink,
): string | undefined {
  if ('originSelectionRange' in definition && definition.originSelectionRange) {
    return document.getText(definition.originSelectionRange);
  }

  return undefined;
}

function assertSelectedDomains(actual: string[], expected: string[]): boolean {
  try {
    assert.deepEqual(actual, expected);
    return true;
  } catch {
    return false;
  }
}
