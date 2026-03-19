# Symfony Dev Tools

VS Code extension focused on day-to-day Symfony development.

Current scope:

- audit and sync Symfony YAML translations used from PHP and Twig
- navigate between routes, controllers, Twig templates, form types, and EasyAdmin form themes
- surface translation issues as editor diagnostics and quick fixes
- show a global translation report in the `Translations` view
- insert context-aware Twig and PHP templates from the active editor
- bootstrap a new Symfony project from a guided module preset
- expose a configurable Symfony Actions view while keeping workspace tasks available from a compatibility command

## Local install

```bash
npm install
npm run compile
npm run package:vsix
code --install-extension symfony-dev-tools-0.2.4.vsix --force
```

## Settings

```json
{
  "symfonyDevTools.actions": {
    "cache": {
      "enabled": false
    },
    "symfony": {
      "title": "Symfony",
      "description": "Symfony local server commands",
      "color": "charts.purple",
      "icon": "$(server-process)",
      "actions": [
        {
          "label": "Restart server",
          "command": "symfony server:stop;symfony server:start"
        }
      ]
    }
  },
  "symfonyDevTools.entityRoots": ["src/Entity"],
  "symfonyDevTools.autoRefreshDiagram": true,
  "symfonyDevTools.includeMappedSuperclass": false,
  "symfonyDevTools.referenceLocale": "fr",
  "symfonyDevTools.translationSyncMode": "create-empty",
  "symfonyDevTools.enableTranslationDiagnostics": true,
  "symfonyDevTools.enableTranslationReport": true
}
```

## Commands

- `symfonyDevTools.scanTranslations`
- `symfonyDevTools.openTranslationsReport`
- `symfonyDevTools.syncTranslations`
- `symfonyDevTools.runAction`
- `symfonyDevTools.insertTemplate`
- `symfonyDevTools.createSymfonyProject`
- `symfonyDevTools.runTask`
- `symfonyDevTools.openEntityDiagram`
- `symfonyDevTools.refreshEntityDiagram`
- `symfonyDevTools.openEntityFile`

## Symfony web navigation

- `Ctrl+click` from Twig `path('route')` and `url('route')` to the matching `#[Route(...)]`
- `Ctrl+click` from PHP `redirectToRoute('route')` and `generateUrl('route')` to the matching `#[Route(...)]`
- `Ctrl+click` from PHP `render('template.html.twig')` and `setFormThemes(['...'])` to the target Twig file
- `Ctrl+click` from Twig form variables such as `registerForm.email` to the `FormType` field
- top-of-file Twig CodeLens for:
  - rendered controllers
  - related form types
  - EasyAdmin CRUD controllers for form themes
- Twig `path()` and `url()` completion:
  - route names in the first argument
  - required route params auto-inserted when the route is selected
  - optional route params proposed later with `Ctrl+Space`

## Actions view

- built-in Symfony action groups are available without defining workspace tasks
- use `symfonyDevTools.actions` to disable a group, replace a built-in group, or append a custom one
- built-in groups keep their default `title`, `description`, `icon`, `color`, and `actions` unless you override those specific fields
- groups accept:
  - `title`
  - `description`
  - `color` as a VS Code theme color id such as `charts.purple`
  - `icon` such as `$(server-process)`
  - `actions[]` with `label`, optional `description`, and `command`
- workspace tasks remain available only through `Symfony Dev Tools: Run Workspace Task`

## Translation audit

- scans `translations/**/*.yaml` and `translations/**/*.yml`
- inspects PHP usages through `t('...')` and `->trans('...')`
- inspects Twig usages through `|trans`, `trans()` and `trans_default_domain`
- reports:
  - missing keys
  - unused keys
  - dynamic or unresolved usages
  - YAML or PHP parse errors
- supports inline escape hatches for dynamic usages:
  - PHP: `// symfony-dev-tools:mark-used <domain>:<pattern>`
  - Twig: `{# symfony-dev-tools:mark-used <domain>:<pattern> #}`
  - to ignore an intentional missing key:
    - PHP: `// symfony-dev-tools:ignore-missing <domain>:<pattern>`
    - Twig: `{# symfony-dev-tools:ignore-missing <domain>:<pattern> #}`
  - legacy alias still supported:
    - PHP: `// symfony-dev-tools:uses-translation <domain>:<pattern>`
    - Twig: `{# symfony-dev-tools:uses-translation <domain>:<pattern> #}`
- quick fixes can:
  - create a missing key
  - ignore a missing key with an annotation
  - delete an unused key
  - mark a dynamic usage with an annotation

Examples:

- `mark-used` means "this file uses these translation keys even if the scanner cannot compute them statically"
- `ignore-missing` means "this usage is intentional even if the key does not exist yet"
- `messages:*` applies to the whole domain in the current file
- `messages:_faq.section_*` applies only to matching keys

`Sync translations` opens a preview and applies only the impacted translation files. Quick fixes apply a targeted change directly.

## Templates

`Insert template` uses the active file context:

- Twig partial files such as `_card.html.twig` receive a partial skeleton
- regular Twig pages receive a page skeleton extending `layout/base.html.twig` when present
- Symfony controllers receive a new action with route, render call, and required imports
- Symfony form types receive a `buildForm()` block with `t('...')` labels and common imports

## Symfony project bootstrap

`Create Symfony Project` opens a guided flow and generates a terminal script from the selected modules:

- Twig
- Security
- Translation
- Webpack Encore
- Stimulus
- Turbo
- Maker
- PHPUnit
- EasyAdmin

The generated project also gets default `.vscode/tasks.json` and `<project>.code-workspace` files aligned with the extension.

## Doctrine diagram

- entity scan is native TypeScript through `php-parser`
- Graphviz JS via `@viz-js/viz` renders the SVG inside the extension runtime
- the diagram opens in a `WebviewPanel` in the editor area
- domain filters and text search are available in the panel
- search keeps first-level neighbours for context
- zoom, fit and drag-pan are available directly in the panel
- auto-refresh reacts to entity edits and saves
- clicking a class opens the mapped PHP file and targets the class declaration when possible

## Development

```bash
npm run compile
npm run test:unit
npm run test:integration
npm run package:vsix
```
