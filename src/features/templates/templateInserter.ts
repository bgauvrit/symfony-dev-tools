import * as path from 'node:path';

import * as vscode from 'vscode';

export interface ControllerTemplateOptions {
  actionName: string;
  routeName: string;
  routePath: string;
  templatePath: string;
}

export function buildControllerActionTemplate(options: ControllerTemplateOptions): string {
  return [
    '',
    `    #[Route('${options.routePath}', name: '${options.routeName}')]`,
    `    public function ${options.actionName}(): Response`,
    '    {',
    `        return $this->render('${options.templatePath}', []);`,
    '    }',
    '',
  ].join('\n');
}

export function buildTwigPageTemplate(baseTemplatePath: string): string {
  return [
    `{% extends '${baseTemplatePath}' %}`,
    '',
    "{% block title %}{{ 'title._'|trans }}{% endblock %}",
    '',
    '{% block body %}',
    '    <section>',
    "        <h1>{{ 'title._'|trans }}</h1>",
    '    </section>',
    '{% endblock %}',
    '',
  ].join('\n');
}

export function buildTwigPartialTemplate(): string {
  return [
    '<section>',
    "    <h2>{{ 'title._'|trans }}</h2>",
    '</section>',
    '',
  ].join('\n');
}

export function buildFormTemplateBlock(): string {
  return [
    '',
    '    public function buildForm(FormBuilderInterface $builder, array $options): void',
    '    {',
    '        $builder',
    "            ->add('name', TextType::class, [",
    "                'label' => t('title._'),",
    '            ])',
    '        ;',
    '    }',
    '',
    '    public function configureOptions(OptionsResolver $resolver): void',
    '    {',
    '        $resolver->setDefaults([]);',
    '    }',
    '',
  ].join('\n');
}

export async function insertContextTemplate(): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (!editor || editor.document.uri.scheme !== 'file') {
    void vscode.window.showWarningMessage('Open a PHP or Twig file before inserting a Symfony template.');
    return;
  }

  const document = editor.document;
  const filePath = document.uri.fsPath;
  const extension = path.extname(filePath).toLowerCase();

  if (extension === '.twig') {
    await insertTwigTemplate(editor);
    return;
  }

  if (extension === '.php') {
    await insertPhpTemplate(editor);
    return;
  }

  void vscode.window.showWarningMessage('This file type is not supported by Symfony Dev Tools templates yet.');
}

async function insertTwigTemplate(editor: vscode.TextEditor): Promise<void> {
  const fileName = path.basename(editor.document.uri.fsPath);
  const isPartial = fileName.startsWith('_');
  const baseTemplatePath = await resolveBaseTemplatePath();
  const snippet = isPartial ? buildTwigPartialTemplate() : buildTwigPageTemplate(baseTemplatePath);
  const fullRange = new vscode.Range(
    editor.document.positionAt(0),
    editor.document.positionAt(editor.document.getText().length),
  );
  const edit = new vscode.WorkspaceEdit();

  edit.replace(editor.document.uri, fullRange, snippet);
  await vscode.workspace.applyEdit(edit);
}

async function insertPhpTemplate(editor: vscode.TextEditor): Promise<void> {
  const text = editor.document.getText();

  if (/extends\s+AbstractController/.test(text)) {
    await insertControllerAction(editor);
    return;
  }

  if (/extends\s+AbstractType/.test(text)) {
    await insertFormBlock(editor);
    return;
  }

  void vscode.window.showWarningMessage('No Symfony controller or form type pattern was detected in this PHP file.');
}

async function insertControllerAction(editor: vscode.TextEditor): Promise<void> {
  const document = editor.document;
  const actionName = (await vscode.window.showInputBox({
    title: 'Symfony controller action',
    prompt: 'Action method name',
    value: 'index',
  }))?.trim();

  if (!actionName) {
    return;
  }

  const defaults = buildControllerDefaults(document.uri.fsPath, actionName);
  const routeName = (await vscode.window.showInputBox({
    title: 'Symfony controller action',
    prompt: 'Route name',
    value: defaults.routeName,
  }))?.trim();
  const routePath = (await vscode.window.showInputBox({
    title: 'Symfony controller action',
    prompt: 'Route path',
    value: defaults.routePath,
  }))?.trim();
  const templatePath = (await vscode.window.showInputBox({
    title: 'Symfony controller action',
    prompt: 'Twig template path',
    value: defaults.templatePath,
  }))?.trim();

  if (!routeName || !routePath || !templatePath) {
    return;
  }

  const updatedText = ensurePhpUses(
    injectBeforeClassClosingBrace(
      document.getText(),
      buildControllerActionTemplate({
        actionName,
        routeName,
        routePath,
        templatePath,
      }),
    ),
    [
      'Symfony\\Component\\HttpFoundation\\Response',
      'Symfony\\Component\\Routing\\Attribute\\Route',
    ],
  );

  await replaceDocument(document, updatedText);
}

async function insertFormBlock(editor: vscode.TextEditor): Promise<void> {
  const document = editor.document;
  const text = document.getText();

  if (/function\s+buildForm\s*\(/.test(text)) {
    void vscode.window.showInformationMessage('This form type already defines buildForm().');
    return;
  }

  const updatedText = ensurePhpUses(injectBeforeClassClosingBrace(text, buildFormTemplateBlock()), [
    'Symfony\\Component\\Form\\Extension\\Core\\Type\\TextType',
    'Symfony\\Component\\Form\\FormBuilderInterface',
    'Symfony\\Component\\OptionsResolver\\OptionsResolver',
  ]);
  const finalText = ensureFunctionImport(updatedText, 'Symfony\\Component\\Translation\\t');

  await replaceDocument(document, finalText);
}

function injectBeforeClassClosingBrace(text: string, snippet: string): string {
  const lastBraceIndex = text.lastIndexOf('}');

  if (lastBraceIndex < 0) {
    return `${text}\n${snippet}`;
  }

  return `${text.slice(0, lastBraceIndex)}${snippet}${text.slice(lastBraceIndex)}`;
}

function ensurePhpUses(text: string, imports: string[]): string {
  let nextText = text;

  for (const importName of imports) {
    const importLine = `use ${importName};`;

    if (nextText.includes(importLine)) {
      continue;
    }

    nextText = insertPhpUse(nextText, importLine);
  }

  return nextText;
}

function ensureFunctionImport(text: string, importName: string): string {
  const importLine = `use function ${importName};`;

  if (text.includes(importLine)) {
    return text;
  }

  return insertPhpUse(text, importLine);
}

function insertPhpUse(text: string, importLine: string): string {
  const useMatches = Array.from(text.matchAll(/^use\b.*;$/gm));

  if (useMatches.length > 0) {
    const lastMatch = useMatches[useMatches.length - 1];
    const insertionOffset = (lastMatch.index ?? 0) + lastMatch[0].length;

    return `${text.slice(0, insertionOffset)}\n${importLine}${text.slice(insertionOffset)}`;
  }

  const namespaceMatch = /^namespace\b.*;$/m.exec(text);

  if (!namespaceMatch || namespaceMatch.index === undefined) {
    return `${importLine}\n${text}`;
  }

  const insertionOffset = namespaceMatch.index + namespaceMatch[0].length;

  return `${text.slice(0, insertionOffset)}\n\n${importLine}${text.slice(insertionOffset)}`;
}

function buildControllerDefaults(filePath: string, actionName: string): {
  routeName: string;
  routePath: string;
  templatePath: string;
} {
  const normalized = filePath.replace(/\\/g, '/');
  const controllerMatch = /\/src\/Controller\/(.+)\/([^/]+)Controller\.php$/i.exec(normalized);
  const rawSegments = controllerMatch
    ? [...controllerMatch[1].split('/').map((entry) => entry.toLowerCase()), controllerMatch[2].replace(/Controller$/i, '').toLowerCase()]
    : ['app'];
  const routeSegments = rawSegments.filter((entry) => entry.length > 0);
  const routeName = `app_${routeSegments.join('_')}_${actionName.toLowerCase()}`;
  const routePath = `/${routeSegments.join('/')}${actionName === 'index' ? '' : `/${actionName.toLowerCase()}`}`.replace(/\/+/g, '/');
  const templateSegments = controllerMatch
    ? [...controllerMatch[1].split('/').map((entry) => entry.toLowerCase()), controllerMatch[2].replace(/Controller$/i, '').toLowerCase()]
    : ['app'];

  return {
    routeName,
    routePath,
    templatePath: `${templateSegments.join('/')}/${actionName.toLowerCase()}.html.twig`,
  };
}

async function resolveBaseTemplatePath(): Promise<string> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

  if (!workspaceFolder) {
    return 'base.html.twig';
  }

  const customBase = path.join(workspaceFolder.uri.fsPath, 'templates', 'layout', 'base.html.twig');

  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(customBase));
    return 'layout/base.html.twig';
  } catch {
    return 'base.html.twig';
  }
}

async function replaceDocument(document: vscode.TextDocument, text: string): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));

  edit.replace(document.uri, fullRange, text);
  await vscode.workspace.applyEdit(edit);
  await document.save();
}
