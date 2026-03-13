import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';

import {
  createEmptySymfonyWebIndex,
  normalizeTemplatePath,
  type FormBinding,
  type FormFieldDefinition,
  type RouteDefinition,
  type RouteUsage,
  type SymfonyWebIndex,
  type TemplateRenderBinding,
  type TextRange,
  type ThemeBinding,
} from './model';
import { parseTwigRouteCalls } from './twig';

const PHPParser = require('php-parser');

type AstNode = Record<string, any>;

interface ParsedPhpFile {
  className?: string;
  filePath: string;
  formTypeDefinition?: FormTypeDefinition;
  routes: RouteDefinition[];
  routeUsages: RouteUsage[];
  templateBindings: TemplateRenderBinding[];
  formReferences: FormReferenceCandidate[];
  themeBindings: ThemeBinding[];
}

interface FormTypeDefinition {
  className: string;
  filePath: string;
  classRange: TextRange;
  fields: FormFieldDefinition[];
}

interface FormReferenceCandidate {
  templatePath: string;
  formVariable: string;
  formTypeClass: string;
  controllerClass: string;
  controllerMethod: string;
  controllerFilePath: string;
  easyAdminThemePaths: string[];
}

interface ScanOptions {
  textOverrides?: Map<string, string>;
}

const parser = new PHPParser.Engine({
  parser: {
    extractDoc: true,
    php7: true,
  },
  ast: {
    withPositions: true,
  },
});

export async function scanSymfonyWebWorkspace(
  workspaceRoot: string,
  options: ScanOptions = {},
): Promise<SymfonyWebIndex> {
  const textOverrides = options.textOverrides ?? new Map<string, string>();
  const phpRoot = path.join(workspaceRoot, 'src');
  const templatesRoot = path.join(workspaceRoot, 'templates');
  const warnings: string[] = [];
  const parsedPhpFiles: ParsedPhpFile[] = [];

  for (const filePath of await collectFiles(phpRoot, ['.php'])) {
    try {
      parsedPhpFiles.push(await parsePhpFile(workspaceRoot, filePath, textOverrides));
    } catch (error) {
      warnings.push(formatError(`Web index scan failed for ${filePath}`, error));
    }
  }

  const formTypeMap = new Map<string, FormTypeDefinition>();

  for (const file of parsedPhpFiles) {
    if (file.formTypeDefinition) {
      formTypeMap.set(file.formTypeDefinition.className, file.formTypeDefinition);
    }
  }

  const twigRouteUsages: RouteUsage[] = [];

  for (const filePath of await collectFiles(templatesRoot, ['.twig'])) {
    try {
      const text = await readWorkspaceText(filePath, textOverrides);

      for (const call of parseTwigRouteCalls(text)) {
        if (!call.routeName || !call.routeNameRange) {
          continue;
        }

        twigRouteUsages.push({
          routeName: call.routeName,
          filePath: path.normalize(filePath),
          range: offsetRangeToTextRange(text, call.routeNameRange.start, call.routeNameRange.end),
          functionName: call.functionName,
          source: 'twig',
        });
      }
    } catch (error) {
      warnings.push(formatError(`Twig route scan failed for ${filePath}`, error));
    }
  }

  const formBindings: FormBinding[] = [];

  for (const file of parsedPhpFiles) {
    for (const reference of file.formReferences) {
      const formType = formTypeMap.get(reference.formTypeClass);

      if (!formType) {
        warnings.push(`Referenced form type not found: ${reference.formTypeClass}`);
        continue;
      }

      formBindings.push({
        templatePath: reference.templatePath,
        formVariable: reference.formVariable,
        formTypeClass: reference.formTypeClass,
        formTypeFilePath: formType.filePath,
        formTypeRange: formType.classRange,
        fieldDefinitions: formType.fields,
        controllerClass: reference.controllerClass,
        controllerMethod: reference.controllerMethod,
        controllerFilePath: reference.controllerFilePath,
        easyAdminThemePaths: reference.easyAdminThemePaths,
      });
    }
  }

  return {
    routes: parsedPhpFiles.flatMap((file) => file.routes).sort((left, right) => left.name.localeCompare(right.name)),
    routeUsages: parsedPhpFiles
      .flatMap((file) => file.routeUsages)
      .concat(twigRouteUsages)
      .sort((left, right) => `${left.routeName}:${left.filePath}`.localeCompare(`${right.routeName}:${right.filePath}`)),
    templateBindings: parsedPhpFiles
      .flatMap((file) => file.templateBindings)
      .sort((left, right) => left.templatePath.localeCompare(right.templatePath)),
    formBindings: formBindings.sort((left, right) =>
      `${left.templatePath}:${left.formVariable}`.localeCompare(`${right.templatePath}:${right.formVariable}`),
    ),
    themeBindings: parsedPhpFiles
      .flatMap((file) => file.themeBindings)
      .sort((left, right) => left.themePath.localeCompare(right.themePath)),
    warnings,
    generatedAt: new Date().toISOString(),
  };
}

export function isSymfonyWebRelevantDocument(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();

  return extension === '.php' || extension === '.twig';
}

export function templatePathFromFilePath(workspaceRoot: string, filePath: string): string | undefined {
  const normalizedWorkspaceRoot = path.normalize(workspaceRoot);
  const normalizedPath = path.normalize(filePath);
  const templatesRoot = path.join(normalizedWorkspaceRoot, 'templates');

  if (!normalizedPath.startsWith(`${templatesRoot}${path.sep}`)) {
    return undefined;
  }

  return normalizeTemplatePath(path.relative(templatesRoot, normalizedPath));
}

export async function loadTwigNamespacePaths(workspaceRoot: string): Promise<Record<string, string>> {
  const twigConfigPath = path.join(workspaceRoot, 'config', 'packages', 'twig.yaml');

  try {
    const parsedConfig = parseYaml(await fs.readFile(twigConfigPath, 'utf8')) as Record<string, unknown> | null;
    const rawPaths = parsedConfig?.twig && typeof parsedConfig.twig === 'object'
      ? (parsedConfig.twig as Record<string, unknown>).paths
      : undefined;

    if (!rawPaths || typeof rawPaths !== 'object' || Array.isArray(rawPaths)) {
      return {};
    }

    const namespaces: Record<string, string> = {};

    for (const [rawRootPath, namespace] of Object.entries(rawPaths)) {
      if (typeof namespace !== 'string' || namespace.trim().length === 0) {
        continue;
      }

      const normalizedRootPath = path.normalize(rawRootPath.replace('%kernel.project_dir%', workspaceRoot));
      namespaces[namespace] = normalizedRootPath;
    }

    return namespaces;
  } catch {
    return {};
  }
}

async function parsePhpFile(
  workspaceRoot: string,
  filePath: string,
  textOverrides: Map<string, string>,
): Promise<ParsedPhpFile> {
  const normalizedFilePath = path.normalize(filePath);
  const code = await readWorkspaceText(normalizedFilePath, textOverrides);
  const ast = parser.parseCode(code) as AstNode;
  const namespaceNode = ast.children?.find((node: AstNode) => node.kind === 'namespace') as AstNode | undefined;

  if (!namespaceNode) {
    return emptyParsedPhpFile(normalizedFilePath);
  }

  const classNode = namespaceNode.children?.find((node: AstNode) => node.kind === 'class') as AstNode | undefined;

  if (!classNode || !classNode.name?.name) {
    return emptyParsedPhpFile(normalizedFilePath);
  }

  const namespace = String(namespaceNode.name ?? '').trim();
  const uses = collectUses(namespaceNode.children ?? []);
  const className = namespace ? `${namespace}\\${classNode.name.name}` : classNode.name.name;
  const classRange = nodeToRange(classNode.name?.loc ?? classNode.loc);
  const formTypeDefinition = parseFormTypeDefinition(classNode, className, normalizedFilePath, classRange);
  const routes: RouteDefinition[] = [];
  const routeUsages: RouteUsage[] = [];
  const templateBindings: TemplateRenderBinding[] = [];
  const formReferences: FormReferenceCandidate[] = [];
  const themeBindings: ThemeBinding[] = [];

  for (const member of classNode.body ?? []) {
    if (member.kind !== 'method' || !member.name?.name) {
      continue;
    }

    const controllerMethod = member.name.name;
    const methodRoutes = parseRouteAttributes(member.attrGroups, className, controllerMethod, normalizedFilePath);
    const methodThemes = collectMethodThemes(member, className, controllerMethod, normalizedFilePath);
    const formAssignments = collectFormAssignments(member, namespace, uses);

    routes.push(...methodRoutes);
    themeBindings.push(...methodThemes.bindings);
    routeUsages.push(...collectPhpRouteUsages(member, normalizedFilePath));

    for (const renderBinding of collectRenderBindings(member, {
      controllerClass: className,
      controllerMethod,
      controllerFilePath: normalizedFilePath,
      routeNames: methodRoutes.map((route) => route.name),
      formAssignments,
      easyAdminThemePaths: methodThemes.paths,
    })) {
      templateBindings.push(renderBinding.binding);
      formReferences.push(...renderBinding.formReferences);
    }
  }

  return {
    className,
    filePath: normalizedFilePath,
    formTypeDefinition,
    routes,
    routeUsages,
    templateBindings,
    formReferences,
    themeBindings,
  };
}

function emptyParsedPhpFile(filePath: string): ParsedPhpFile {
  return {
    filePath,
    routes: [],
    routeUsages: [],
    templateBindings: [],
    formReferences: [],
    themeBindings: [],
  };
}

function parseFormTypeDefinition(
  classNode: AstNode,
  className: string,
  filePath: string,
  classRange: TextRange,
): FormTypeDefinition {
  const fieldsByName = new Map<string, FormFieldDefinition>();

  walkAst(classNode, (node) => {
    if (node.kind !== 'call' || getCalledMethodName(node) !== 'add') {
      return;
    }

    const firstArgument = node.arguments?.[0];
    const fieldName = getStringValue(firstArgument);

    if (!fieldName || fieldsByName.has(fieldName)) {
      return;
    }

    fieldsByName.set(fieldName, {
      name: fieldName,
      range: nodeToRange(firstArgument.loc),
    });
  });

  return {
    className,
    filePath,
    classRange,
    fields: Array.from(fieldsByName.values()),
  };
}

function parseRouteAttributes(
  attrGroups: AstNode[] | undefined,
  controllerClass: string,
  controllerMethod: string,
  filePath: string,
): RouteDefinition[] {
  const routes: RouteDefinition[] = [];

  for (const group of attrGroups ?? []) {
    for (const attribute of group.attrs ?? []) {
      if (getShortName(attribute.name) !== 'Route') {
        continue;
      }

      const argumentsMap = collectArguments(attribute.args);
      const name = asString(argumentsMap.values.name ?? argumentsMap.values[1]);

      if (!name) {
        continue;
      }

      const rawPath = argumentsMap.values.path ?? argumentsMap.values[0];
      const localizedPaths = normalizeLocalizedPaths(rawPath);
      const placeholders = extractRoutePlaceholders(localizedPaths);
      const defaults = normalizeDefaults(argumentsMap.values.defaults);
      const optionalParams = placeholders.filter((placeholder) => Object.prototype.hasOwnProperty.call(defaults, placeholder));
      const requiredParams = placeholders.filter((placeholder) => !optionalParams.includes(placeholder));

      routes.push({
        name,
        controllerClass,
        controllerMethod,
        filePath,
        attributeRange: nodeToRange(attribute.loc),
        nameRange: nodeToRange(argumentsMap.nodes.name?.loc ?? argumentsMap.nodes[1]?.loc ?? attribute.loc),
        localizedPaths,
        requiredParams,
        optionalParams,
        defaults,
      });
    }
  }

  return routes;
}

function collectMethodThemes(
  methodNode: AstNode,
  controllerClass: string,
  controllerMethod: string,
  controllerFilePath: string,
): { paths: string[]; bindings: ThemeBinding[] } {
  const paths = new Set<string>();
  const bindings: ThemeBinding[] = [];

  walkAst(methodNode.body, (node) => {
    if (node.kind !== 'call' || getCalledMethodName(node) !== 'setFormThemes') {
      return;
    }

    const themesNode = node.arguments?.[0];

    if (!themesNode || themesNode.kind !== 'array') {
      return;
    }

    for (const entry of themesNode.items ?? []) {
      const valueNode = entry.value ?? entry;
      const themePath = getStringValue(valueNode);

      if (!themePath) {
        continue;
      }

      const normalizedThemePath = normalizeTemplatePath(themePath);
      paths.add(normalizedThemePath);
      bindings.push({
        themePath: normalizedThemePath,
        controllerClass,
        controllerMethod,
        controllerFilePath,
        range: nodeToRange(valueNode.loc),
      });
    }
  });

  return {
    paths: Array.from(paths.values()).sort((left, right) => left.localeCompare(right)),
    bindings,
  };
}

function collectFormAssignments(
  methodNode: AstNode,
  namespace: string,
  uses: Map<string, string>,
): Map<string, string> {
  const assignments = new Map<string, string>();

  walkAst(methodNode.body, (node) => {
    if (node.kind !== 'assign' || node.left?.kind !== 'variable' || node.right?.kind !== 'call') {
      return;
    }

    if (getCalledMethodName(node.right) !== 'createForm') {
      return;
    }

    const variableName = typeof node.left.name === 'string' ? node.left.name : undefined;
    const formTypeClass = resolveClassReference(node.right.arguments?.[0], namespace, uses);

    if (!variableName || !formTypeClass) {
      return;
    }

    assignments.set(variableName, formTypeClass);
  });

  return assignments;
}

function collectPhpRouteUsages(methodNode: AstNode, filePath: string): RouteUsage[] {
  const usages: RouteUsage[] = [];

  walkAst(methodNode.body, (node) => {
    if (node.kind !== 'call') {
      return;
    }

    const functionName = getCalledMethodName(node);

    if (functionName !== 'redirectToRoute' && functionName !== 'generateUrl') {
      return;
    }

    const firstArgument = node.arguments?.[0];
    const routeName = getStringValue(firstArgument);

    if (!routeName || !firstArgument?.loc) {
      return;
    }

    usages.push({
      routeName,
      filePath,
      range: nodeToRange(firstArgument.loc),
      functionName,
      source: 'php',
    });
  });

  return usages;
}

function collectRenderBindings(
  methodNode: AstNode,
  context: {
    controllerClass: string;
    controllerMethod: string;
    controllerFilePath: string;
    routeNames: string[];
    formAssignments: Map<string, string>;
    easyAdminThemePaths: string[];
  },
): Array<{ binding: TemplateRenderBinding; formReferences: FormReferenceCandidate[] }> {
  const bindings: Array<{ binding: TemplateRenderBinding; formReferences: FormReferenceCandidate[] }> = [];

  walkAst(methodNode.body, (node) => {
    if (node.kind !== 'call') {
      return;
    }

    const methodName = getCalledMethodName(node);

    if (methodName !== 'render' && methodName !== 'renderForm') {
      return;
    }

    const templateArgument = node.arguments?.[0];
    const templatePath = getStringValue(templateArgument);

    if (!templatePath || !templateArgument?.loc) {
      return;
    }

    const normalizedTemplatePath = normalizeTemplatePath(templatePath);
    const formReferences = collectRenderFormReferences(
      node.arguments?.[1],
      normalizedTemplatePath,
      context,
    );

    bindings.push({
      binding: {
        templatePath: normalizedTemplatePath,
        controllerClass: context.controllerClass,
        controllerMethod: context.controllerMethod,
        controllerFilePath: context.controllerFilePath,
        renderRange: nodeToRange(templateArgument.loc),
        routeNames: context.routeNames,
      },
      formReferences,
    });
  });

  return bindings;
}

function collectRenderFormReferences(
  renderDataNode: AstNode | undefined,
  templatePath: string,
  context: {
    controllerClass: string;
    controllerMethod: string;
    controllerFilePath: string;
    formAssignments: Map<string, string>;
    easyAdminThemePaths: string[];
  },
): FormReferenceCandidate[] {
  const references: FormReferenceCandidate[] = [];

  if (!renderDataNode || renderDataNode.kind !== 'array') {
    return references;
  }

  for (const entry of renderDataNode.items ?? []) {
    const key = getStringValue(entry.key);
    const variableName = getRenderedFormVariableName(entry.value);

    if (!key || !variableName) {
      continue;
    }

    const formTypeClass = context.formAssignments.get(variableName);

    if (!formTypeClass) {
      continue;
    }

    references.push({
      templatePath,
      formVariable: key,
      formTypeClass,
      controllerClass: context.controllerClass,
      controllerMethod: context.controllerMethod,
      controllerFilePath: context.controllerFilePath,
      easyAdminThemePaths: context.easyAdminThemePaths,
    });
  }

  return references;
}

function getRenderedFormVariableName(node: AstNode | undefined): string | undefined {
  if (!node) {
    return undefined;
  }

  if (node.kind === 'variable' && typeof node.name === 'string') {
    return node.name;
  }

  if (
    node.kind === 'call' &&
    getCalledMethodName(node) === 'createView' &&
    node.what?.kind === 'propertylookup' &&
    node.what.what?.kind === 'variable'
  ) {
    return typeof node.what.what.name === 'string' ? node.what.what.name : undefined;
  }

  return undefined;
}

function collectUses(nodes: AstNode[]): Map<string, string> {
  const uses = new Map<string, string>();

  for (const node of nodes) {
    if (node.kind !== 'usegroup') {
      continue;
    }

    for (const item of node.items ?? []) {
      const resolved = node.name ? `${node.name}\\${item.name}` : item.name;
      const alias = item.alias?.name ?? getShortName(item.name);
      uses.set(alias, resolved);
    }
  }

  return uses;
}

function collectArguments(args: AstNode[] | undefined): {
  values: Record<string | number, unknown>;
  nodes: Record<string | number, AstNode>;
} {
  const values: Record<string | number, unknown> = {};
  const nodes: Record<string | number, AstNode> = {};
  let positionalIndex = 0;

  for (const argument of args ?? []) {
    if (argument.kind === 'namedargument') {
      values[argument.name] = parseArgumentValue(argument.value);
      nodes[argument.name] = argument.value;
      continue;
    }

    values[positionalIndex] = parseArgumentValue(argument);
    nodes[positionalIndex] = argument;
    positionalIndex += 1;
  }

  return {
    values,
    nodes,
  };
}

function parseArgumentValue(node: AstNode | undefined): unknown {
  if (!node) {
    return undefined;
  }

  switch (node.kind) {
    case 'boolean':
      return Boolean(node.value);
    case 'nullkeyword':
      return null;
    case 'number':
      return Number(node.value);
    case 'string':
      return node.value;
    case 'array':
      return parseArrayValue(node);
    case 'name':
      return node.name;
    case 'identifier':
      return node.name;
    case 'staticlookup':
      if (node.offset?.name === 'class') {
        return node.what?.name;
      }

      return `${node.what?.name ?? ''}::${node.offset?.name ?? ''}`;
    default:
      return undefined;
  }
}

function parseArrayValue(node: AstNode): unknown {
  const items = node.items ?? [];
  const hasNamedEntries = items.some((entry: AstNode) => entry.key);

  if (!hasNamedEntries) {
    return items.map((entry: AstNode) => parseArgumentValue(entry.value ?? entry));
  }

  const result: Record<string, unknown> = {};

  for (const entry of items) {
    const key = parseArrayKey(entry.key);

    if (!key) {
      continue;
    }

    result[key] = parseArgumentValue(entry.value ?? entry);
  }

  return result;
}

function parseArrayKey(node: AstNode | undefined): string | undefined {
  if (!node) {
    return undefined;
  }

  if (node.kind === 'string') {
    return node.value;
  }

  if (node.kind === 'number') {
    return String(node.value);
  }

  if (node.kind === 'identifier' || node.kind === 'name') {
    return node.name;
  }

  return undefined;
}

function normalizeLocalizedPaths(value: unknown): Record<string, string> {
  if (typeof value === 'string' && value.length > 0) {
    return {
      default: value,
    };
  }

  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return {};
  }

  const localizedPaths: Record<string, string> = {};

  for (const [locale, localizedPath] of Object.entries(value)) {
    if (typeof localizedPath === 'string' && localizedPath.length > 0) {
      localizedPaths[locale] = localizedPath;
    }
  }

  return localizedPaths;
}

function normalizeDefaults(value: unknown): Record<string, string | number | boolean | null> {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return {};
  }

  const defaults: Record<string, string | number | boolean | null> = {};

  for (const [key, entryValue] of Object.entries(value)) {
    if (
      typeof entryValue === 'string' ||
      typeof entryValue === 'number' ||
      typeof entryValue === 'boolean' ||
      entryValue === null
    ) {
      defaults[key] = entryValue;
    }
  }

  return defaults;
}

function extractRoutePlaceholders(localizedPaths: Record<string, string>): string[] {
  const placeholders = new Set<string>();

  for (const localizedPath of Object.values(localizedPaths)) {
    const matches = localizedPath.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g);

    for (const match of matches) {
      if (match[1]) {
        placeholders.add(match[1]);
      }
    }
  }

  return Array.from(placeholders.values()).sort((left, right) => left.localeCompare(right));
}

function resolveClassReference(
  node: AstNode | undefined,
  namespace: string,
  uses: Map<string, string>,
): string | undefined {
  if (!node || node.kind !== 'staticlookup' || node.offset?.name !== 'class') {
    return undefined;
  }

  const rawName = node.what?.name;

  if (typeof rawName !== 'string' || rawName.length === 0) {
    return undefined;
  }

  return resolveClassName(rawName, namespace, uses);
}

function resolveClassName(rawName: string, namespace: string, uses: Map<string, string>): string {
  if (rawName.startsWith('\\')) {
    return rawName.slice(1);
  }

  const segments = rawName.split('\\');
  const head = segments[0] ?? rawName;
  const imported = uses.get(head);

  if (imported) {
    return [imported, ...segments.slice(1)].join('\\');
  }

  if (rawName.includes('\\')) {
    return rawName;
  }

  return namespace ? `${namespace}\\${rawName}` : rawName;
}

function getShortName(name: unknown): string {
  const normalized = String(name ?? '').replace(/^\\/, '');
  const segments = normalized.split('\\');

  return segments[segments.length - 1] ?? normalized;
}

function getCalledMethodName(node: AstNode | undefined): string | undefined {
  if (!node || node.kind !== 'call') {
    return undefined;
  }

  if (node.what?.kind === 'propertylookup') {
    return node.what.offset?.name;
  }

  if (node.what?.kind === 'staticlookup') {
    return node.what.offset?.name;
  }

  return undefined;
}

function getStringValue(node: AstNode | undefined): string | undefined {
  return node?.kind === 'string' ? node.value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function walkAst(node: AstNode | AstNode[] | undefined, visitor: (node: AstNode) => void): void {
  if (!node) {
    return;
  }

  if (Array.isArray(node)) {
    for (const entry of node) {
      walkAst(entry, visitor);
    }
    return;
  }

  visitor(node);

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry && typeof entry === 'object') {
          walkAst(entry as AstNode, visitor);
        }
      }
      continue;
    }

    if (value && typeof value === 'object') {
      walkAst(value as AstNode, visitor);
    }
  }
}

function nodeToRange(location: AstNode | undefined): TextRange {
  const startLine = Math.max(0, Number(location?.start?.line ?? 1) - 1);
  const endLine = Math.max(0, Number(location?.end?.line ?? location?.start?.line ?? 1) - 1);

  return {
    start: {
      line: startLine,
      character: Math.max(0, Number(location?.start?.column ?? 0)),
    },
    end: {
      line: endLine,
      character: Math.max(0, Number(location?.end?.column ?? location?.start?.column ?? 0)),
    },
  };
}

function offsetRangeToTextRange(text: string, startOffset: number, endOffset: number): TextRange {
  return {
    start: offsetToTextPosition(text, startOffset),
    end: offsetToTextPosition(text, endOffset),
  };
}

function offsetToTextPosition(text: string, offset: number): { line: number; character: number } {
  let line = 0;
  let character = 0;

  for (let index = 0; index < offset && index < text.length; index += 1) {
    if (text.charAt(index) === '\n') {
      line += 1;
      character = 0;
      continue;
    }

    character += 1;
  }

  return {
    line,
    character,
  };
}

async function collectFiles(root: string, extensions: string[]): Promise<string[]> {
  try {
    const stat = await fs.stat(root);

    if (!stat.isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  const collected: string[] = [];
  const entries = await fs.readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const nextPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      collected.push(...(await collectFiles(nextPath, extensions)));
      continue;
    }

    if (entry.isFile() && extensions.includes(path.extname(entry.name).toLowerCase())) {
      collected.push(path.normalize(nextPath));
    }
  }

  return collected.sort((left, right) => left.localeCompare(right));
}

async function readWorkspaceText(filePath: string, textOverrides: Map<string, string>): Promise<string> {
  const normalizedPath = path.normalize(filePath);

  return textOverrides.get(normalizedPath) ?? fs.readFile(normalizedPath, 'utf8');
}

function formatError(prefix: string, error: unknown): string {
  if (error instanceof Error) {
    return `${prefix}: ${error.message}`;
  }

  return prefix;
}

export function routeParamSnippet(paramName: string, placeholderIndex: number): string {
  if (paramName === '_locale') {
    return '_locale: app.request.locale';
  }

  if (paramName === 'id') {
    return `id: \${${placeholderIndex}:id}`;
  }

  if (paramName === 'slug') {
    return `slug: \${${placeholderIndex}:slug}`;
  }

  return `${paramName}: \${${placeholderIndex}:${paramName}}`;
}
