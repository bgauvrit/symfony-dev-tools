import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import * as vscode from 'vscode';
import { LineCounter, isMap, isScalar, parseDocument, type YAMLMap } from 'yaml';

import {
  createEmptyTranslationAuditModel,
  createEmptyTranslationSummary,
  type TranslationAuditModel,
  type TranslationDefinition,
  type TranslationDirective,
  type TranslationIssue,
  type TranslationParseError,
  type TranslationUsage,
} from './model';

const PHPParser = require('php-parser');

const phpParser = new PHPParser.Engine({
  parser: {
    extractDoc: true,
    php7: true,
  },
  ast: {
    withPositions: true,
  },
});

const IGNORED_DIRECTORIES = new Set(['.git', '.vscode-test', 'dist', 'node_modules', 'var', 'vendor']);
const DEFAULT_TRANSLATION_DOMAIN = 'messages';
const TRANSLATION_TODO_MARKER = 'symfony-dev-tools:todo';

type AstNode = Record<string, any>;
type TwigResolvedValue =
  | {
      kind: 'string';
      value: string;
    }
  | {
      kind: 'number';
      value: number;
    }
  | {
      kind: 'map';
      entries: Map<string, TwigResolvedValue>;
    };
type TwigEnvironment = Map<string, TwigResolvedValue>;

export interface TranslationPairState {
  key: string;
  pathSegments: string[];
  blockStartOffset: number;
  blockEndOffset: number;
  keyRange: vscode.Range;
  childKeys: string[];
  isBranch: boolean;
}

export interface TranslationFileState {
  filePath: string;
  text: string;
  domain: string;
  locale: string;
  formatSuffix: string;
  extension: '.yaml' | '.yml';
  definitions: TranslationDefinition[];
  pairStates: Map<string, TranslationPairState>;
  parseErrors: TranslationParseError[];
}

export interface TranslationWorkspaceState {
  audit: TranslationAuditModel;
  translationFiles: TranslationFileState[];
}

interface TranslationFileLoadResult {
  translationFiles: TranslationFileState[];
  fullyIgnoredDomains: Set<string>;
}

export async function scanTranslationWorkspace(
  workspaceRoot: string,
  options: {
    referenceLocale: string;
    ignoredTranslationFiles?: string[];
    textOverrides?: Map<string, string>;
  },
): Promise<TranslationWorkspaceState> {
  const audit = createEmptyTranslationAuditModel();
  const translationRoot = path.join(workspaceRoot, 'translations');
  const textOverrides = options.textOverrides ?? new Map<string, string>();
  const translationFileLoadResult = await loadTranslationFiles(
    workspaceRoot,
    translationRoot,
    textOverrides,
    options.ignoredTranslationFiles ?? [],
  );
  const translationFiles = translationFileLoadResult.translationFiles;
  const fullyIgnoredDomains = translationFileLoadResult.fullyIgnoredDomains;
  const sourceFiles = await collectSourceFiles(workspaceRoot);
  const directives: TranslationDirective[] = [];
  const usages: TranslationUsage[] = [];
  const issues: TranslationIssue[] = [];
  const definitions = translationFiles.flatMap((fileState) => fileState.definitions);
  const definitionMap = new Map<string, TranslationDefinition>();
  const domainLocales = new Map<string, Set<string>>();
  const domainFileVariants = new Map<string, { formatSuffix: string; extension: '.yaml' | '.yml' }>();

  for (const fileState of translationFiles) {
    if (!domainLocales.has(fileState.domain)) {
      domainLocales.set(fileState.domain, new Set<string>());
    }

    domainLocales.get(fileState.domain)?.add(fileState.locale);
    domainFileVariants.set(fileState.domain, {
      formatSuffix: fileState.formatSuffix,
      extension: fileState.extension,
    });

    for (const definition of fileState.definitions) {
      definitionMap.set(buildDefinitionLookupKey(definition.domain, definition.locale, definition.key), definition);
    }

    for (const parseError of fileState.parseErrors) {
      issues.push({
        id: buildIssueId('parseError', fileState.filePath, undefined, undefined, parseError.message),
        kind: 'parseError',
        severity: 'error',
        message: parseError.message,
        sourceFilePath: parseError.filePath,
        sourceRange: parseError.range,
      });
    }
  }

  for (const filePath of sourceFiles) {
    const normalizedPath = path.normalize(filePath);
    const text = textOverrides.get(normalizedPath) ?? (await fs.readFile(filePath, 'utf8'));

    directives.push(...scanTranslationDirectives(normalizedPath, text));

    if (normalizedPath.endsWith('.php')) {
      const phpScan = scanPhpTranslationUsages(normalizedPath, text);
      usages.push(...phpScan.usages);
      issues.push(...phpScan.parseErrors);
      continue;
    }

    if (normalizedPath.endsWith('.twig')) {
      const twigScan = scanTwigTranslationUsages(normalizedPath, text);
      usages.push(...twigScan.usages);
    }
  }

  const staticUsages = usages.filter((usage) => !usage.isDynamic && usage.key);
  const dynamicUsages = usages.filter((usage) => usage.isDynamic);
  const referencedKeySet = new Set(staticUsages.map((usage) => buildReferenceKey(usage.domain, usage.key ?? '')));

  for (const usage of staticUsages) {
    if (fullyIgnoredDomains.has(usage.domain)) {
      continue;
    }

    if (
      usage.key &&
      hasMatchingDirective(directives, ['ignoreMissing'], usage.filePath, usage.domain, usage.key)
    ) {
      continue;
    }

    const locales = Array.from(domainLocales.get(usage.domain) ?? []).sort((left, right) => left.localeCompare(right));
    const targetLocales = locales.length > 0 ? locales : [options.referenceLocale];
    const missingLocales = targetLocales.filter(
      (locale) => !definitionMap.has(buildDefinitionLookupKey(usage.domain, locale, usage.key ?? '')),
    );

    if (missingLocales.length === 0) {
      continue;
    }

    issues.push({
      id: buildUsageIssueId('missing', usage, missingLocales.join(',')),
      kind: 'missing',
      severity: 'error',
      message: `Missing translation "${usage.key}" in domain "${usage.domain}" for locale(s): ${missingLocales.join(', ')}`,
      sourceFilePath: usage.filePath,
      sourceRange: usage.range,
      domain: usage.domain,
      key: usage.key,
      locale: missingLocales.join(','),
      usageId: usage.id,
    });
  }

  for (const usage of dynamicUsages) {
    if (hasSourceDirective(directives, ['markUsed'], usage.filePath, usage.domain)) {
      continue;
    }

    issues.push({
      id: buildUsageIssueId('dynamic', usage, usage.rawText),
      kind: 'dynamic',
      severity: 'warning',
      message: `Dynamic translation usage in domain "${usage.domain}" cannot be resolved statically.`,
      sourceFilePath: usage.filePath,
      sourceRange: usage.range,
      domain: usage.domain,
      usageId: usage.id,
    });
  }

  for (const definition of definitions) {
    if (definition.hasTodoMarker) {
      issues.push({
        id: buildIssueId('todo', definition.filePath, definition.domain, definition.key, definition.locale),
        kind: 'todo',
        severity: 'error',
        message: `Auto-generated translation "${definition.key}" in domain "${definition.domain}" (${definition.locale}) still needs to be reviewed.`,
        sourceFilePath: definition.filePath,
        sourceRange: definition.range,
        domain: definition.domain,
        locale: definition.locale,
        key: definition.key,
        definitionId: definition.id,
        relatedFilePath: definition.filePath,
        relatedRange: definition.range,
      });
      continue;
    }

    const referenceKey = buildReferenceKey(definition.domain, definition.key);

    if (referencedKeySet.has(referenceKey)) {
      continue;
    }

    if (hasMatchingDirective(directives, ['markUsed'], undefined, definition.domain, definition.key)) {
      continue;
    }

    issues.push({
      id: buildIssueId('unused', definition.filePath, definition.domain, definition.key, definition.locale),
      kind: 'unused',
      severity: isCategoryTranslationKey(definition.key) ? 'warning' : 'error',
      message: `Unused translation "${definition.key}" in domain "${definition.domain}" (${definition.locale}).`,
      sourceFilePath: definition.filePath,
      sourceRange: definition.range,
      domain: definition.domain,
      locale: definition.locale,
      key: definition.key,
      definitionId: definition.id,
      relatedFilePath: definition.filePath,
      relatedRange: definition.range,
    });
  }

  const domains = Array.from(new Set([...definitionMap.values()].map((definition) => definition.domain))).sort((left, right) =>
    left.localeCompare(right),
  );
  const locales = Array.from(
    new Set([...definitionMap.values()].map((definition) => definition.locale).concat(options.referenceLocale)),
  ).sort((left, right) => left.localeCompare(right));

  audit.generatedAt = new Date().toISOString();
  audit.definitions = definitions.sort((left, right) => left.key.localeCompare(right.key));
  audit.usages = usages.sort((left, right) => left.filePath.localeCompare(right.filePath));
  audit.directives = directives.sort((left, right) => left.filePath.localeCompare(right.filePath));
  audit.issues = issues.sort(compareIssues);
  audit.summary = {
    domains,
    locales,
    missingCount: audit.issues.filter((issue) => issue.kind === 'missing').length,
    unusedCount: audit.issues.filter((issue) => issue.kind === 'unused').length,
    dynamicCount: audit.issues.filter((issue) => issue.kind === 'dynamic').length,
    parseErrorCount: audit.issues.filter((issue) => issue.kind === 'parseError').length,
    todoCount: audit.issues.filter((issue) => issue.kind === 'todo').length,
    issueCount: audit.issues.length,
  };

  return {
    audit,
    translationFiles: translationFiles.sort((left, right) => left.filePath.localeCompare(right.filePath)),
  };
}

async function loadTranslationFiles(
  workspaceRoot: string,
  translationRoot: string,
  textOverrides: Map<string, string>,
  ignoredTranslationFiles: string[],
): Promise<TranslationFileLoadResult> {
  try {
    const stat = await fs.stat(translationRoot);

    if (!stat.isDirectory()) {
      return {
        translationFiles: [],
        fullyIgnoredDomains: new Set<string>(),
      };
    }
  } catch {
    return {
      translationFiles: [],
      fullyIgnoredDomains: new Set<string>(),
    };
  }

  const filePaths = await collectFiles(translationRoot, new Set(['.yaml', '.yml']));
  const translationFiles: TranslationFileState[] = [];
  const totalFilesByDomain = new Map<string, number>();
  const loadedFilesByDomain = new Map<string, number>();

  for (const filePath of filePaths) {
    const normalizedPath = path.normalize(filePath);
    const parsedFileName = parseTranslationFileName(path.basename(filePath));

    if (!parsedFileName) {
      continue;
    }

    totalFilesByDomain.set(parsedFileName.domain, (totalFilesByDomain.get(parsedFileName.domain) ?? 0) + 1);

    if (matchesIgnoredTranslationFile(workspaceRoot, normalizedPath, ignoredTranslationFiles)) {
      continue;
    }

    const text = textOverrides.get(normalizedPath) ?? (await fs.readFile(filePath, 'utf8'));
    loadedFilesByDomain.set(parsedFileName.domain, (loadedFilesByDomain.get(parsedFileName.domain) ?? 0) + 1);
    translationFiles.push(parseTranslationFile(normalizedPath, text, parsedFileName));
  }

  const fullyIgnoredDomains = new Set<string>();

  for (const [domain, totalCount] of totalFilesByDomain.entries()) {
    if (totalCount > 0 && (loadedFilesByDomain.get(domain) ?? 0) === 0) {
      fullyIgnoredDomains.add(domain);
    }
  }

  return {
    translationFiles,
    fullyIgnoredDomains,
  };
}

function parseTranslationFile(
  filePath: string,
  text: string,
  parsedFileName: {
    domain: string;
    locale: string;
    formatSuffix: string;
    extension: '.yaml' | '.yml';
  },
): TranslationFileState {
  const lineCounter = new LineCounter();
  const document = parseDocument(text, {
    lineCounter,
    keepSourceTokens: true,
    prettyErrors: true,
    strict: false,
  });
  const definitions: TranslationDefinition[] = [];
  const pairStates = new Map<string, TranslationPairState>();
  const parseErrors: TranslationParseError[] = [
    ...document.errors.map((error) => createYamlParseError(filePath, error.message, error.pos?.[0] ?? 0, lineCounter, text)),
    ...document.warnings.map((warning) =>
      createYamlParseError(filePath, warning.message, warning.pos?.[0] ?? 0, lineCounter, text),
    ),
  ];

  if (document.contents && isMap(document.contents)) {
    traverseYamlMap(filePath, parsedFileName.domain, parsedFileName.locale, document.contents, [], lineCounter, text, pairStates, definitions);
  }

  return {
    filePath,
    text,
    domain: parsedFileName.domain,
    locale: parsedFileName.locale,
    formatSuffix: parsedFileName.formatSuffix,
    extension: parsedFileName.extension,
    definitions,
    pairStates,
    parseErrors,
  };
}

function traverseYamlMap(
  filePath: string,
  domain: string,
  locale: string,
  map: YAMLMap<unknown, unknown>,
  parentSegments: string[],
  lineCounter: LineCounter,
  text: string,
  pairStates: Map<string, TranslationPairState>,
  definitions: TranslationDefinition[],
): string[] {
  const childKeys: string[] = [];

  for (const pair of map.items) {
    if (!isScalar(pair.key)) {
      continue;
    }

    const segment = String(pair.key.value ?? '').trim();

    if (segment.length === 0) {
      continue;
    }

    const pathSegments = [...parentSegments, segment];
    const normalizedKey = pathSegments.join('.');
    const pairValue = pair.value;
    const blockStartOffset = pair.key.range?.[0] ?? 0;
    const blockEndOffset = getYamlNodeEndOffset(pairValue, pair.key.range?.[2] ?? blockStartOffset);
    const isBranch = isMap(pairValue);
    const keyRange = createRangeFromOffsets(blockStartOffset, pair.key.range?.[2] ?? blockStartOffset, text);
    const nestedChildKeys = isBranch
      ? traverseYamlMap(
          filePath,
          domain,
          locale,
          pairValue as YAMLMap<unknown, unknown>,
          pathSegments,
          lineCounter,
          text,
          pairStates,
          definitions,
        )
      : [];

    pairStates.set(normalizedKey, {
      key: normalizedKey,
      pathSegments,
      blockStartOffset,
      blockEndOffset,
      keyRange,
      childKeys: nestedChildKeys,
      isBranch,
    });
    childKeys.push(normalizedKey);

    if (!isBranch) {
      definitions.push({
        id: `${filePath}:${domain}:${locale}:${normalizedKey}`,
        domain,
        locale,
        key: normalizedKey,
        filePath,
        range: createRangeFromOffsets(blockStartOffset, blockEndOffset, text),
        value: extractYamlLeafValue(pair.value),
        hasTodoMarker: hasTranslationTodoMarker(text, blockStartOffset),
      });
    }
  }

  return childKeys;
}

function extractYamlLeafValue(node: unknown): string | null {
  if (node == null) {
    return null;
  }

  if (isScalar(node)) {
    return node.value == null ? null : String(node.value);
  }

  return null;
}

function getYamlNodeEndOffset(node: unknown, fallbackOffset: number): number {
  if (node && typeof node === 'object' && 'range' in node && Array.isArray(node.range)) {
    return Number(node.range[2] ?? node.range[1] ?? node.range[0] ?? fallbackOffset);
  }

  return fallbackOffset;
}

function hasTranslationTodoMarker(text: string, blockStartOffset: number): boolean {
  const lineStart = text.lastIndexOf('\n', Math.max(0, blockStartOffset - 1)) + 1;
  const lineEnd = text.indexOf('\n', blockStartOffset);
  const lineText = text.slice(lineStart, lineEnd >= 0 ? lineEnd : text.length);

  return lineText.includes(TRANSLATION_TODO_MARKER);
}

function createYamlParseError(
  filePath: string,
  message: string,
  offset: number,
  lineCounter: LineCounter,
  text: string,
): TranslationParseError {
  const start = offsetToPosition(offset, text);
  const end = new vscode.Position(start.line, start.character + 1);

  return {
    filePath,
    message: `YAML parse error: ${message}`,
    range: new vscode.Range(start, end),
  };
}

async function collectSourceFiles(workspaceRoot: string): Promise<string[]> {
  const filePaths = await collectFiles(workspaceRoot, new Set(['.php', '.twig']));

  return filePaths.filter((filePath) => !filePath.includes(`${path.sep}translations${path.sep}`));
}

async function collectFiles(rootDir: string, extensions: Set<string>): Promise<string[]> {
  const collected: string[] = [];
  const entries = await fs.readdir(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      collected.push(...(await collectFiles(path.join(rootDir, entry.name), extensions)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();

    if (extensions.has(extension)) {
      collected.push(path.join(rootDir, entry.name));
    }
  }

  return collected.sort((left, right) => left.localeCompare(right));
}

function parseTranslationFileName(fileName: string):
  | {
      domain: string;
      locale: string;
      formatSuffix: string;
      extension: '.yaml' | '.yml';
    }
  | undefined {
  const match = /^(?<domain>.+?)(?<formatSuffix>\+intl-icu)?\.(?<locale>[A-Za-z0-9_@-]+)(?<extension>\.ya?ml)$/i.exec(fileName);

  if (!match?.groups) {
    return undefined;
  }

  return {
    domain: match.groups.domain,
    locale: match.groups.locale,
    formatSuffix: match.groups.formatSuffix ?? '',
    extension: match.groups.extension.toLowerCase() as '.yaml' | '.yml',
  };
}

function scanPhpTranslationUsages(
  filePath: string,
  text: string,
): {
  usages: TranslationUsage[];
  parseErrors: TranslationIssue[];
} {
  const usages: TranslationUsage[] = [];
  const parseErrors: TranslationIssue[] = [];

  try {
    const ast = phpParser.parseCode(text) as AstNode;

    walkPhpAst(ast, (node) => {
      if (node.kind !== 'call') {
        return;
      }

      const callName = resolvePhpCallName(node.what);

      if (callName !== 't' && callName !== 'trans') {
        return;
      }

      const domain = resolvePhpDomain(node.arguments, callName === 't' ? DEFAULT_TRANSLATION_DOMAIN : DEFAULT_TRANSLATION_DOMAIN);
      const firstArgument = Array.isArray(node.arguments) ? node.arguments[0] : undefined;
      const usageRange = createRangeFromLoc(node.loc, text);

      if (firstArgument?.kind === 'string') {
        usages.push({
          id: `${filePath}:${usageRange.start.line}:${usageRange.start.character}:${domain}:${firstArgument.value}`,
          sourceLanguage: 'php',
          filePath,
          range: createRangeFromLoc(firstArgument.loc, text),
          domain,
          key: String(firstArgument.value),
          defaultDomain: DEFAULT_TRANSLATION_DOMAIN,
          isDynamic: false,
          rawText: String(firstArgument.raw ?? firstArgument.value),
        });
        return;
      }

      usages.push({
        id: `${filePath}:${usageRange.start.line}:${usageRange.start.character}:${domain}:dynamic`,
        sourceLanguage: 'php',
        filePath,
        range: usageRange,
        domain,
        key: undefined,
        defaultDomain: DEFAULT_TRANSLATION_DOMAIN,
        isDynamic: true,
        rawText: getPhpNodeText(firstArgument, text),
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to parse PHP translation usages.';
    const range = new vscode.Range(0, 0, 0, 1);

    parseErrors.push({
      id: buildIssueId('parseError', filePath, undefined, undefined, message),
      kind: 'parseError',
      severity: 'error',
      message: `PHP parse error: ${message}`,
      sourceFilePath: filePath,
      sourceRange: range,
    });
  }

  return {
    usages,
    parseErrors,
  };
}

function walkPhpAst(node: AstNode | AstNode[] | undefined, visitNode: (node: AstNode) => void): void {
  if (!node) {
    return;
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      walkPhpAst(child, visitNode);
    }

    return;
  }

  if (typeof node !== 'object') {
    return;
  }

  visitNode(node);

  for (const value of Object.values(node)) {
    if (!value || typeof value !== 'object') {
      continue;
    }

    walkPhpAst(value as AstNode | AstNode[], visitNode);
  }
}

function resolvePhpCallName(what: AstNode | undefined): string | undefined {
  if (!what) {
    return undefined;
  }

  if (what.kind === 'name') {
    return String(what.name);
  }

  if (what.kind === 'propertylookup' && what.offset?.kind === 'identifier') {
    return String(what.offset.name);
  }

  return undefined;
}

function resolvePhpDomain(argumentsNodes: AstNode[] | undefined, fallbackDomain: string): string {
  if (!Array.isArray(argumentsNodes) || argumentsNodes.length < 3) {
    return fallbackDomain;
  }

  const domainNode = argumentsNodes[2];

  if (domainNode?.kind === 'string') {
    return String(domainNode.value);
  }

  return fallbackDomain;
}

function getPhpNodeText(node: AstNode | undefined, text: string): string {
  if (node?.loc?.start?.offset === undefined || node.loc.end?.offset === undefined) {
    return 'dynamic';
  }

  return text.slice(node.loc.start.offset, node.loc.end.offset);
}

function scanTwigTranslationUsages(filePath: string, text: string): { usages: TranslationUsage[] } {
  const usages: TranslationUsage[] = [];
  const defaultDomain = resolveTwigDefaultDomain(text) ?? DEFAULT_TRANSLATION_DOMAIN;
  const tokenRegex = /(\{%[\s\S]*?%\}|\{\{[\s\S]*?\}\})/g;
  const loopEnvironmentsStack: TwigEnvironment[][] = [];
  let currentEnvironments: TwigEnvironment[] = [new Map()];

  for (const match of text.matchAll(tokenRegex)) {
    const token = match[0];
    const tokenStart = match.index ?? 0;

    if (token.startsWith('{%')) {
      const inner = token.slice(2, -2);
      const trimmedInner = inner.trim();

      if (/^endfor\b/.test(trimmedInner)) {
        currentEnvironments = loopEnvironmentsStack.pop() ?? currentEnvironments;
        continue;
      }

      const forMatch = /^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([\s\S]+)$/m.exec(trimmedInner);

      if (forMatch) {
        loopEnvironmentsStack.push(currentEnvironments.map((environment) => new Map(environment)));
        currentEnvironments = expandTwigForEnvironments(currentEnvironments, forMatch[1], forMatch[2]);
        continue;
      }

      const setMatch = /^set\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]+)$/m.exec(trimmedInner);

      if (setMatch) {
        const variableName = setMatch[1];
        const expression = setMatch[2].trim();
        const expressionOffset = tokenStart + 2 + inner.indexOf(expression);

        usages.push(
          ...scanTwigExpressionTranslationUsages(
            filePath,
            text,
            expression,
            expressionOffset,
            defaultDomain,
            currentEnvironments,
          ),
        );
        currentEnvironments = currentEnvironments.map((environment) => {
          const nextEnvironment = new Map(environment);
          const resolvedValue = evaluateTwigValue(expression, environment);

          if (resolvedValue) {
            nextEnvironment.set(variableName, resolvedValue);
          } else {
            nextEnvironment.delete(variableName);
          }

          return nextEnvironment;
        });
        continue;
      }

      usages.push(
        ...scanTwigExpressionTranslationUsages(
          filePath,
          text,
          trimmedInner,
          tokenStart + 2 + inner.indexOf(trimmedInner),
          defaultDomain,
          currentEnvironments,
        ),
      );
      continue;
    }

    if (token.startsWith('{{')) {
      const inner = token.slice(2, -2);

      usages.push(
        ...scanTwigExpressionTranslationUsages(
          filePath,
          text,
          inner,
          tokenStart + 2,
          defaultDomain,
          currentEnvironments,
        ),
      );
    }
  }

  return {
    usages: dedupeUsages(usages),
  };
}

function dedupeUsages(usages: TranslationUsage[]): TranslationUsage[] {
  const seen = new Set<string>();
  const deduped: TranslationUsage[] = [];

  for (const usage of usages) {
    const key = `${usage.filePath}:${usage.range.start.line}:${usage.range.start.character}:${usage.domain}:${usage.key ?? 'dynamic'}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(usage);
  }

  return deduped;
}

function scanTwigExpressionTranslationUsages(
  filePath: string,
  text: string,
  expressionSource: string,
  expressionOffset: number,
  defaultDomain: string,
  environments: TwigEnvironment[],
): TranslationUsage[] {
  const usages: TranslationUsage[] = [];
  const segments = collectTwigScanSegments(expressionSource, expressionOffset);

  for (const segment of segments) {
    usages.push(...scanTwigTopLevelFilterUsages(filePath, text, segment.expressionSource, segment.expressionOffset, defaultDomain, environments));
    usages.push(...scanTwigTopLevelFunctionUsages(filePath, text, segment.expressionSource, segment.expressionOffset, defaultDomain, environments));
  }

  return usages;
}

function addResolvedTwigUsages(
  usages: TranslationUsage[],
  filePath: string,
  text: string,
  expressionText: string,
  expressionStart: number,
  expressionEnd: number,
  domain: string,
  defaultDomain: string,
  environments: TwigEnvironment[],
): void {
  const resolvedKeys = new Set<string>();
  let hasUnresolvedEnvironment = false;

  for (const environment of environments) {
    const resolvedValue = evaluateTwigValue(expressionText, environment);

    if (resolvedValue?.kind === 'string') {
      resolvedKeys.add(resolvedValue.value);
      continue;
    }

    if (resolvedValue?.kind === 'number') {
      resolvedKeys.add(String(resolvedValue.value));
      continue;
    }

    hasUnresolvedEnvironment = true;
  }

  for (const resolvedKey of resolvedKeys) {
    usages.push({
      id: `${filePath}:${expressionStart}:${domain}:${resolvedKey}`,
      sourceLanguage: 'twig',
      filePath,
      range: createRangeFromOffsets(expressionStart, expressionEnd, text),
      domain,
      key: resolvedKey,
      defaultDomain,
      isDynamic: false,
      rawText: expressionText,
    });
  }

  if (resolvedKeys.size === 0) {
    usages.push({
      id: `${filePath}:${expressionStart}:${domain}:dynamic`,
      sourceLanguage: 'twig',
      filePath,
      range: createRangeFromOffsets(expressionStart, expressionEnd, text),
      domain,
      key: undefined,
      defaultDomain,
      isDynamic: true,
      rawText: expressionText,
    });
  }
}

function scanTwigTopLevelFilterUsages(
  filePath: string,
  text: string,
  expressionSource: string,
  expressionOffset: number,
  defaultDomain: string,
  environments: TwigEnvironment[],
): TranslationUsage[] {
  const usages: TranslationUsage[] = [];
  const pipeIndexes = findTwigTopLevelOperatorIndexes(expressionSource, '|');

  for (const pipeIndex of pipeIndexes) {
    const filter = parseTwigFilterAt(expressionSource, pipeIndex);

    if (!filter || filter.name !== 'trans') {
      continue;
    }

    const operandStart = findTwigOperandStart(expressionSource, pipeIndex);
    const operandRaw = expressionSource.slice(operandStart, pipeIndex);
    const operand = operandRaw.trim();

    if (operand.length === 0) {
      continue;
    }

    const trimmedStart = operandStart + Math.max(0, operandRaw.indexOf(operand));
    const trimmedEnd = trimmedStart + operand.length;

    addResolvedTwigUsages(
      usages,
      filePath,
      text,
      operand,
      expressionOffset + trimmedStart,
      expressionOffset + trimmedEnd,
      resolveTwigDomainFromArgs(filter.args, defaultDomain, 1),
      defaultDomain,
      environments,
    );
  }

  return usages;
}

function scanTwigTopLevelFunctionUsages(
  filePath: string,
  text: string,
  expressionSource: string,
  expressionOffset: number,
  defaultDomain: string,
  environments: TwigEnvironment[],
): TranslationUsage[] {
  const usages: TranslationUsage[] = [];

  for (let index = 0; index < expressionSource.length; index += 1) {
    if (!isTwigTopLevelIndex(expressionSource, index)) {
      continue;
    }

    if (!expressionSource.startsWith('trans', index) || !isTwigFunctionBoundary(expressionSource, index)) {
      continue;
    }

    const nameEnd = index + 'trans'.length;
    const parenStart = skipTwigWhitespace(expressionSource, nameEnd);

    if (expressionSource[parenStart] !== '(') {
      continue;
    }

    const parenEnd = findTwigMatchingParen(expressionSource, parenStart);

    if (parenEnd < 0) {
      continue;
    }

    const args = expressionSource.slice(parenStart + 1, parenEnd);
    const parts = splitTwigArguments(args);
    const keyExpression = parts[0]?.trim() ?? '';

    if (keyExpression.length === 0) {
      index = parenEnd;
      continue;
    }

    const keyExpressionOffset = args.indexOf(keyExpression);

    addResolvedTwigUsages(
      usages,
      filePath,
      text,
      keyExpression,
      expressionOffset + parenStart + 1 + Math.max(0, keyExpressionOffset),
      expressionOffset + parenStart + 1 + Math.max(0, keyExpressionOffset) + keyExpression.length,
      resolveTwigDomainFromArgs(args, defaultDomain, 2),
      defaultDomain,
      environments,
    );

    index = parenEnd;
  }

  return usages;
}

function collectTwigScanSegments(
  expressionSource: string,
  expressionOffset: number,
): Array<{ expressionSource: string; expressionOffset: number }> {
  const segments = [
    {
      expressionSource,
      expressionOffset,
    },
  ];
  let quote: "'" | '"' | undefined;
  const parenthesisStack: number[] = [];

  for (let index = 0; index < expressionSource.length; index += 1) {
    const character = expressionSource[index];
    const previousCharacter = index > 0 ? expressionSource[index - 1] : undefined;

    if (quote) {
      if (character === quote && previousCharacter !== '\\') {
        quote = undefined;
      }

      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character === '(') {
      parenthesisStack.push(index);
      continue;
    }

    if (character === ')' && parenthesisStack.length > 0) {
      const start = parenthesisStack.pop();

      if (start === undefined) {
        continue;
      }

      const nestedExpression = expressionSource.slice(start + 1, index);

      if (nestedExpression.trim().length > 0) {
        segments.push(...collectTwigScanSegments(nestedExpression, expressionOffset + start + 1));
      }
    }
  }

  return segments;
}

function expandTwigForEnvironments(
  environments: TwigEnvironment[],
  variableName: string,
  iterableExpression: string,
): TwigEnvironment[] {
  const expanded: TwigEnvironment[] = [];

  for (const environment of environments) {
    const values = evaluateTwigIterable(iterableExpression, environment);

    if (values.length === 0) {
      continue;
    }

    for (const value of values) {
      const nextEnvironment = new Map(environment);

      nextEnvironment.set(variableName, {
        kind: 'number',
        value,
      });
      expanded.push(nextEnvironment);
    }
  }

  return expanded.length > 0 ? expanded : environments;
}

function evaluateTwigIterable(expression: string, environment: TwigEnvironment): number[] {
  const trimmedExpression = trimOuterTwigParentheses(expression.trim());
  const separatorIndex = findTwigTopLevelOperator(trimmedExpression, '..');

  if (separatorIndex < 0) {
    return [];
  }

  const startExpression = trimmedExpression.slice(0, separatorIndex).trim();
  const endExpression = trimmedExpression.slice(separatorIndex + 2).trim();
  const startValue = evaluateTwigValue(startExpression, environment);
  const endValue = evaluateTwigValue(endExpression, environment);

  if (startValue?.kind !== 'number' || endValue?.kind !== 'number') {
    return [];
  }

  const values: number[] = [];

  for (let value = startValue.value; value <= endValue.value; value += 1) {
    values.push(value);
  }

  return values;
}

function evaluateTwigValue(expression: string, environment: TwigEnvironment): TwigResolvedValue | undefined {
  const trimmedExpression = trimOuterTwigParentheses(expression.trim());

  if (trimmedExpression.length === 0) {
    return undefined;
  }

  if (isTwigMapLiteral(trimmedExpression)) {
    return parseTwigMapLiteral(trimmedExpression, environment);
  }

  const concatParts = splitTwigTopLevel(trimmedExpression, '~');

  if (concatParts.length > 1) {
    let composedValue = '';

    for (const part of concatParts) {
      const resolvedPart = evaluateTwigValue(part, environment);

      if (!resolvedPart || resolvedPart.kind === 'map') {
        return undefined;
      }

      composedValue += resolvedPart.kind === 'number' ? String(resolvedPart.value) : resolvedPart.value;
    }

    return {
      kind: 'string',
      value: composedValue,
    };
  }

  const indexAccess = parseTwigIndexAccess(trimmedExpression);

  if (indexAccess) {
    const targetValue = evaluateTwigValue(indexAccess.targetExpression, environment);
    const indexValue = evaluateTwigValue(indexAccess.indexExpression, environment);

    if (targetValue?.kind !== 'map' || !indexValue || indexValue.kind === 'map') {
      return undefined;
    }

    const mapKey = indexValue.kind === 'number' ? String(indexValue.value) : indexValue.value;

    return targetValue.entries.get(mapKey);
  }

  const literalString = extractTwigStringLiteral(trimmedExpression);

  if (literalString !== undefined) {
    return {
      kind: 'string',
      value: literalString,
    };
  }

  if (/^-?\d+$/.test(trimmedExpression)) {
    return {
      kind: 'number',
      value: Number.parseInt(trimmedExpression, 10),
    };
  }

  return environment.get(trimmedExpression);
}

function isTwigMapLiteral(expression: string): boolean {
  return expression.startsWith('{') && expression.endsWith('}') && findTwigTopLevelOperator(expression, ':') >= 0;
}

function parseTwigMapLiteral(expression: string, environment: TwigEnvironment): TwigResolvedValue | undefined {
  const inner = expression.slice(1, -1).trim();
  const entries = new Map<string, TwigResolvedValue>();

  if (inner.length === 0) {
    return {
      kind: 'map',
      entries,
    };
  }

  for (const part of splitTwigArguments(inner)) {
    const separatorIndex = findTwigTopLevelOperator(part, ':');

    if (separatorIndex < 0) {
      return undefined;
    }

    const keyExpression = part.slice(0, separatorIndex).trim();
    const valueExpression = part.slice(separatorIndex + 1).trim();
    const resolvedKey = evaluateTwigValue(keyExpression, environment);
    const resolvedValue = evaluateTwigValue(valueExpression, environment);

    if (!resolvedKey || !resolvedValue || resolvedKey.kind === 'map') {
      return undefined;
    }

    const normalizedKey = resolvedKey.kind === 'number' ? String(resolvedKey.value) : resolvedKey.value;

    entries.set(normalizedKey, resolvedValue);
  }

  return {
    kind: 'map',
    entries,
  };
}

function parseTwigIndexAccess(expression: string): { targetExpression: string; indexExpression: string } | undefined {
  if (!expression.endsWith(']')) {
    return undefined;
  }

  let quote: "'" | '"' | undefined;
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenthesisDepth = 0;

  for (let index = expression.length - 1; index >= 0; index -= 1) {
    const character = expression[index];
    const previousCharacter = index > 0 ? expression[index - 1] : undefined;

    if (quote) {
      if (character === quote && previousCharacter !== '\\') {
        quote = undefined;
      }

      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character === ']') {
      bracketDepth += 1;
      continue;
    }

    if (character === '[') {
      bracketDepth -= 1;

      if (braceDepth === 0 && bracketDepth === 0 && parenthesisDepth === 0) {
        return {
          targetExpression: expression.slice(0, index).trim(),
          indexExpression: expression.slice(index + 1, -1).trim(),
        };
      }

      continue;
    }

    if (character === '}') {
      braceDepth += 1;
      continue;
    }

    if (character === '{') {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }

    if (character === ')') {
      parenthesisDepth += 1;
      continue;
    }

    if (character === '(') {
      parenthesisDepth = Math.max(0, parenthesisDepth - 1);
    }
  }

  return undefined;
}

function trimOuterTwigParentheses(expression: string): string {
  let nextExpression = expression.trim();

  while (nextExpression.startsWith('(') && nextExpression.endsWith(')') && hasBalancedOuterTwigParentheses(nextExpression)) {
    nextExpression = nextExpression.slice(1, -1).trim();
  }

  return nextExpression;
}

function hasBalancedOuterTwigParentheses(expression: string): boolean {
  let quote: "'" | '"' | undefined;
  let depth = 0;

  for (let index = 0; index < expression.length; index += 1) {
    const character = expression[index];
    const previousCharacter = index > 0 ? expression[index - 1] : undefined;

    if (quote) {
      if (character === quote && previousCharacter !== '\\') {
        quote = undefined;
      }

      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character === '(') {
      depth += 1;
      continue;
    }

    if (character === ')') {
      depth -= 1;

      if (depth === 0 && index < expression.length - 1) {
        return false;
      }
    }
  }

  return depth === 0;
}

function resolveTwigDefaultDomain(text: string): string | undefined {
  const match = /\{%\s*trans_default_domain\s+(['"])([^'"]+)\1\s*%\}/.exec(text);

  return match?.[2];
}

function resolveTwigDomainFromArgs(args: string, fallbackDomain: string, domainArgumentIndex: number): string {
  const normalizedArgs = args.trim().replace(/^,\s*/, '');

  if (normalizedArgs.length === 0) {
    return fallbackDomain;
  }

  const parts = splitTwigArguments(normalizedArgs);
  const namedDomainPart = parts.find((part) => /^domain\s*[:=]/.test(part));

  if (namedDomainPart) {
    const namedValue = extractNamedTwigArgumentValue(namedDomainPart);
    const namedDomain = namedValue ? extractTwigStringLiteral(namedValue) : undefined;

    if (namedDomain) {
      return namedDomain;
    }
  }

  const domainCandidate = parts[domainArgumentIndex];
  const literalDomain = domainCandidate ? extractTwigStringLiteral(domainCandidate) : undefined;

  return literalDomain ?? fallbackDomain;
}

function splitTwigArguments(args: string): string[] {
  return splitTwigTopLevel(args, ',');
}

function findTwigTopLevelOperatorIndexes(expression: string, operator: string): number[] {
  const indexes: number[] = [];
  let quote: "'" | '"' | undefined;
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenthesisDepth = 0;

  for (let index = 0; index < expression.length; index += 1) {
    const character = expression[index];
    const previousCharacter = index > 0 ? expression[index - 1] : undefined;

    if (quote) {
      if (character === quote && previousCharacter !== '\\') {
        quote = undefined;
      }

      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character === '{') {
      braceDepth += 1;
      continue;
    }

    if (character === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }

    if (character === '[') {
      bracketDepth += 1;
      continue;
    }

    if (character === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (character === '(') {
      parenthesisDepth += 1;
      continue;
    }

    if (character === ')') {
      parenthesisDepth = Math.max(0, parenthesisDepth - 1);
      continue;
    }

    if (
      braceDepth === 0 &&
      bracketDepth === 0 &&
      parenthesisDepth === 0 &&
      expression.startsWith(operator, index)
    ) {
      indexes.push(index);
      index += operator.length - 1;
    }
  }

  return indexes;
}

function parseTwigFilterAt(
  expressionSource: string,
  pipeIndex: number,
): {
  name: string;
  args: string;
} | undefined {
  const filterStart = skipTwigWhitespace(expressionSource, pipeIndex + 1);
  const nameMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(expressionSource.slice(filterStart));

  if (!nameMatch) {
    return undefined;
  }

  const name = nameMatch[0];
  const afterNameIndex = filterStart + name.length;
  const parenStart = skipTwigWhitespace(expressionSource, afterNameIndex);

  if (expressionSource[parenStart] !== '(') {
    return {
      name,
      args: '',
    };
  }

  const parenEnd = findTwigMatchingParen(expressionSource, parenStart);

  if (parenEnd < 0) {
    return undefined;
  }

  return {
    name,
    args: expressionSource.slice(parenStart + 1, parenEnd),
  };
}

function findTwigOperandStart(expressionSource: string, pipeIndex: number): number {
  let quote: "'" | '"' | undefined;
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenthesisDepth = 0;

  for (let index = pipeIndex - 1; index >= 0; index -= 1) {
    const character = expressionSource[index];
    const previousCharacter = index > 0 ? expressionSource[index - 1] : undefined;

    if (quote) {
      if (character === quote && previousCharacter !== '\\') {
        quote = undefined;
      }

      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character === '}') {
      braceDepth += 1;
      continue;
    }

    if (character === '{') {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }

    if (character === ']') {
      bracketDepth += 1;
      continue;
    }

    if (character === '[') {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (character === ')') {
      parenthesisDepth += 1;
      continue;
    }

    if (character === '(') {
      parenthesisDepth = Math.max(0, parenthesisDepth - 1);
      continue;
    }

    if (braceDepth > 0 || bracketDepth > 0 || parenthesisDepth > 0) {
      continue;
    }

    if (isTwigExpressionBoundary(expressionSource, index)) {
      return index + 1;
    }
  }

  return 0;
}

function isTwigExpressionBoundary(expressionSource: string, index: number): boolean {
  const character = expressionSource[index];
  const nextCharacter = index < expressionSource.length - 1 ? expressionSource[index + 1] : undefined;

  if (character === '?' || character === ':' || character === ',') {
    return true;
  }

  if (character === '=' && nextCharacter !== '=') {
    return true;
  }

  return false;
}

function isTwigTopLevelIndex(expressionSource: string, targetIndex: number): boolean {
  let quote: "'" | '"' | undefined;
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenthesisDepth = 0;

  for (let index = 0; index < expressionSource.length; index += 1) {
    const character = expressionSource[index];
    const previousCharacter = index > 0 ? expressionSource[index - 1] : undefined;

    if (quote) {
      if (character === quote && previousCharacter !== '\\') {
        quote = undefined;
      }

      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (index === targetIndex) {
      return braceDepth === 0 && bracketDepth === 0 && parenthesisDepth === 0;
    }

    if (character === '{') {
      braceDepth += 1;
      continue;
    }

    if (character === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }

    if (character === '[') {
      bracketDepth += 1;
      continue;
    }

    if (character === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (character === '(') {
      parenthesisDepth += 1;
      continue;
    }

    if (character === ')') {
      parenthesisDepth = Math.max(0, parenthesisDepth - 1);
    }
  }

  return false;
}

function isTwigFunctionBoundary(expressionSource: string, startIndex: number): boolean {
  const previousCharacter = startIndex > 0 ? expressionSource[startIndex - 1] : undefined;

  return previousCharacter === undefined || !/[A-Za-z0-9_]/.test(previousCharacter);
}

function skipTwigWhitespace(expressionSource: string, startIndex: number): number {
  let index = startIndex;

  while (index < expressionSource.length && /\s/.test(expressionSource[index])) {
    index += 1;
  }

  return index;
}

function findTwigMatchingParen(expressionSource: string, startIndex: number): number {
  let quote: "'" | '"' | undefined;
  let depth = 0;

  for (let index = startIndex; index < expressionSource.length; index += 1) {
    const character = expressionSource[index];
    const previousCharacter = index > 0 ? expressionSource[index - 1] : undefined;

    if (quote) {
      if (character === quote && previousCharacter !== '\\') {
        quote = undefined;
      }

      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character === '(') {
      depth += 1;
      continue;
    }

    if (character === ')') {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function splitTwigTopLevel(expression: string, operator: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: "'" | '"' | undefined;
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenthesisDepth = 0;

  for (let index = 0; index < expression.length; index += 1) {
    const character = expression[index];
    const previousCharacter = index > 0 ? expression[index - 1] : undefined;

    if (quote) {
      current += character;

      if (character === quote && previousCharacter !== '\\') {
        quote = undefined;
      }

      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      current += character;
      continue;
    }

    if (character === '{') {
      braceDepth += 1;
      current += character;
      continue;
    }

    if (character === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
      current += character;
      continue;
    }

    if (character === '[') {
      bracketDepth += 1;
      current += character;
      continue;
    }

    if (character === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
      current += character;
      continue;
    }

    if (character === '(') {
      parenthesisDepth += 1;
      current += character;
      continue;
    }

    if (character === ')') {
      parenthesisDepth = Math.max(0, parenthesisDepth - 1);
      current += character;
      continue;
    }

    if (
      braceDepth === 0 &&
      bracketDepth === 0 &&
      parenthesisDepth === 0 &&
      expression.startsWith(operator, index)
    ) {
      if (current.trim().length > 0) {
        parts.push(current.trim());
      }

      current = '';
      index += operator.length - 1;
      continue;
    }

    current += character;
  }

  if (current.trim().length > 0) {
    parts.push(current.trim());
  }

  return parts;
}

function findTwigTopLevelOperator(expression: string, operator: string): number {
  let quote: "'" | '"' | undefined;
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenthesisDepth = 0;

  for (let index = 0; index < expression.length; index += 1) {
    const character = expression[index];
    const previousCharacter = index > 0 ? expression[index - 1] : undefined;

    if (quote) {
      if (character === quote && previousCharacter !== '\\') {
        quote = undefined;
      }

      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character === '{') {
      braceDepth += 1;
      continue;
    }

    if (character === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }

    if (character === '[') {
      bracketDepth += 1;
      continue;
    }

    if (character === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (character === '(') {
      parenthesisDepth += 1;
      continue;
    }

    if (character === ')') {
      parenthesisDepth = Math.max(0, parenthesisDepth - 1);
      continue;
    }

    if (
      braceDepth === 0 &&
      bracketDepth === 0 &&
      parenthesisDepth === 0 &&
      expression.startsWith(operator, index)
    ) {
      return index;
    }
  }

  return -1;
}

function extractTwigStringLiteral(value: string): string | undefined {
  const trimmed = value.trim();
  const match = /^(['"])(.*)\1$/.exec(trimmed);

  return match?.[2];
}

function extractNamedTwigArgumentValue(part: string): string | undefined {
  const match = /^[A-Za-z_][A-Za-z0-9_]*\s*[:=]\s*(.+)$/.exec(part.trim());

  return match?.[1]?.trim();
}

function scanTranslationDirectives(filePath: string, text: string): TranslationDirective[] {
  const directives: TranslationDirective[] = [];
  const extension = path.extname(filePath).toLowerCase();
  const regex =
    extension === '.twig'
      ? /\{#\s*symfony-dev-tools:(uses-translation|mark-used|ignore-missing)\s+([A-Za-z0-9_.+-]+):([A-Za-z0-9*_.-]+)\s*#\}/g
      : /\/\/\s*symfony-dev-tools:(uses-translation|mark-used|ignore-missing)\s+([A-Za-z0-9_.+-]+):([A-Za-z0-9*_.-]+)/g;

  for (const match of text.matchAll(regex)) {
    const kind = resolveTranslationDirectiveKind(match[1]);
    const domain = match[2];
    const pattern = match[3];
    const start = match.index ?? 0;
    const end = start + match[0].length;

    directives.push({
      kind,
      sourceLanguage: extension === '.twig' ? 'twig' : 'php',
      filePath,
      domain,
      pattern,
      range: createRangeFromOffsets(start, end, text),
    });
  }

  return directives;
}

function resolveTranslationDirectiveKind(directiveName: string): TranslationDirective['kind'] {
  return directiveName === 'ignore-missing' ? 'ignoreMissing' : 'markUsed';
}

function hasMatchingDirective(
  directives: TranslationDirective[],
  kinds: TranslationDirective['kind'][],
  sourceFilePath: string | undefined,
  domain: string,
  key: string,
): boolean {
  return directives.some((directive) => {
    if (!kinds.includes(directive.kind)) {
      return false;
    }

    if (directive.domain !== domain) {
      return false;
    }

    if (sourceFilePath && directive.filePath !== sourceFilePath) {
      return false;
    }

    return wildcardToRegExp(directive.pattern).test(key);
  });
}

function hasSourceDirective(
  directives: TranslationDirective[],
  kinds: TranslationDirective['kind'][],
  sourceFilePath: string,
  domain: string,
): boolean {
  return directives.some(
    (directive) =>
      kinds.includes(directive.kind) &&
      directive.filePath === sourceFilePath &&
      directive.domain === domain,
  );
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');

  return new RegExp(`^${escaped}$`);
}

function matchesIgnoredTranslationFile(
  workspaceRoot: string,
  filePath: string,
  ignoredPatterns: string[],
): boolean {
  if (ignoredPatterns.length === 0) {
    return false;
  }

  const normalizedRelativePath = normalizeGlobPath(path.relative(workspaceRoot, filePath));
  const normalizedBaseName = normalizeGlobPath(path.basename(filePath));

  return ignoredPatterns.some((pattern) => {
    const normalizedPattern = normalizeGlobPath(pattern);
    const target = normalizedPattern.includes('/') ? normalizedRelativePath : normalizedBaseName;

    return globToRegExp(normalizedPattern).test(target);
  });
}

function normalizeGlobPath(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase();
}

function globToRegExp(pattern: string): RegExp {
  let expression = '^';

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    const nextCharacter = index < pattern.length - 1 ? pattern[index + 1] : undefined;

    if (character === '*') {
      if (nextCharacter === '*') {
        expression += '.*';
        index += 1;
      } else {
        expression += '[^/]*';
      }

      continue;
    }

    if (character === '?') {
      expression += '[^/]';
      continue;
    }

    expression += /[\\^$+?.()|{}[\]]/.test(character) ? `\\${character}` : character;
  }

  expression += '$';

  return new RegExp(expression);
}

function buildReferenceKey(domain: string, key: string): string {
  return `${domain}:${key}`;
}

function isCategoryTranslationKey(key: string): boolean {
  return key.endsWith('._');
}

function buildDefinitionLookupKey(domain: string, locale: string, key: string): string {
  return `${domain}:${locale}:${key}`;
}

function buildIssueId(
  kind: TranslationIssue['kind'],
  filePath: string,
  domain: string | undefined,
  key: string | undefined,
  suffix: string | undefined,
): string {
  return [kind, filePath, domain ?? '', key ?? '', suffix ?? ''].join('|');
}

function buildUsageIssueId(
  kind: TranslationIssue['kind'],
  usage: TranslationUsage,
  suffix: string | undefined,
): string {
  return [kind, usage.id, suffix ?? ''].join('|');
}

function compareIssues(left: TranslationIssue, right: TranslationIssue): number {
  const leftKey = `${left.kind}:${left.domain ?? ''}:${left.locale ?? ''}:${left.key ?? ''}:${left.sourceFilePath}:${left.sourceRange.start.line}`;
  const rightKey = `${right.kind}:${right.domain ?? ''}:${right.locale ?? ''}:${right.key ?? ''}:${right.sourceFilePath}:${right.sourceRange.start.line}`;

  return leftKey.localeCompare(rightKey);
}

function createRangeFromLoc(loc: AstNode['loc'] | undefined, text: string): vscode.Range {
  if (!loc?.start?.offset && loc?.start?.offset !== 0) {
    return new vscode.Range(0, 0, 0, 1);
  }

  return createRangeFromOffsets(loc.start.offset, loc.end?.offset ?? loc.start.offset, text);
}

function createRangeFromOffsets(startOffset: number, endOffset: number, text: string): vscode.Range {
  const start = offsetToPosition(startOffset, text);
  const end = offsetToPosition(Math.max(startOffset, endOffset), text);

  return new vscode.Range(start, end);
}

function offsetToPosition(offset: number, text: string): vscode.Position {
  const normalizedOffset = Math.max(0, Math.min(offset, text.length));
  let line = 0;
  let lastLineStart = 0;

  for (let index = 0; index < normalizedOffset; index += 1) {
    if (text[index] === '\n') {
      line += 1;
      lastLineStart = index + 1;
    }
  }

  return new vscode.Position(line, normalizedOffset - lastLineStart);
}
