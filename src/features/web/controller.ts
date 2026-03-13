import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import * as vscode from 'vscode';

import {
  createEmptySymfonyWebIndex,
  type FormBinding,
  type NavigationTarget,
  type RouteDefinition,
  type RouteUsage,
  type SymfonyWebIndex,
  type TemplateRenderBinding,
  type TextRange,
  type ThemeBinding,
} from './model';
import {
  isSymfonyWebRelevantDocument,
  loadTwigNamespacePaths,
  routeParamSnippet,
  scanSymfonyWebWorkspace,
  templatePathFromFilePath,
} from './indexer';
import { findTwigIdentifierChainAt, findTwigRouteCallAt } from './twig';

const RESERVED_TWIG_FORM_SEGMENTS = new Set([
  'children',
  'errors',
  'vars',
]);

export class SymfonyWebController implements vscode.Disposable {
  private latestIndex: SymfonyWebIndex = createEmptySymfonyWebIndex();
  private twigNamespacePaths: Record<string, string> = {};
  private refreshTimer: NodeJS.Timeout | undefined;
  private refreshPromise: Promise<void> | undefined;
  private hasScanned = false;

  public constructor(private readonly context: vscode.ExtensionContext) {}

  public getIndex(): SymfonyWebIndex {
    return this.latestIndex;
  }

  public async refresh(): Promise<void> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.doRefresh();

    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = undefined;
    }
  }

  public scheduleRefreshForDocument(document: vscode.TextDocument): void {
    if (document.uri.scheme !== 'file' || !isSymfonyWebRelevantDocument(document.uri.fsPath)) {
      return;
    }

    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    this.refreshTimer = setTimeout(() => {
      void this.refresh();
    }, 200);
  }

  public async findDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.LocationLink[] | undefined> {
    await this.ensureIndex();

    const routeUsage = this.findRouteUsageAt(document.uri.fsPath, position);

    if (routeUsage) {
      const routeDefinition = this.latestIndex.routes.find((route) => route.name === routeUsage.routeName);

      if (routeDefinition) {
        return [
          buildLocationLink(routeUsage.range, routeDefinition.filePath, routeDefinition.nameRange),
        ];
      }
    }

    const renderBinding = this.findTemplateBindingAt(document.uri.fsPath, position);

    if (renderBinding) {
      const templateUri = this.resolveWorkspaceTemplateUri(renderBinding.templatePath);

      if (templateUri) {
        return [
          buildLocationLink(renderBinding.renderRange, templateUri.fsPath, zeroTextRange()),
        ];
      }
    }

    const themeBinding = this.findThemeBindingAt(document.uri.fsPath, position);

    if (themeBinding) {
      const themeUri = this.resolveWorkspaceTemplateUri(themeBinding.themePath);

      if (themeUri) {
        return [
          buildLocationLink(themeBinding.range, themeUri.fsPath, zeroTextRange()),
        ];
      }
    }

    if (document.languageId === 'twig') {
      const formTarget = this.findTwigFormTarget(document, position);

      if (formTarget) {
        return [
          buildLocationLink(formTarget.range, formTarget.filePath, formTarget.range),
        ];
      }

      const sourceTarget = await this.findTwigResourceTarget(document, position);

      if (sourceTarget) {
        return [
          buildLocationLink(sourceTarget.range, sourceTarget.filePath, zeroTextRange()),
        ];
      }
    }

    return undefined;
  }

  public async findReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    includeDeclaration: boolean,
  ): Promise<vscode.Location[] | undefined> {
    await this.ensureIndex();

    const routeName =
      this.findRouteDefinitionAt(document.uri.fsPath, position)?.name ??
      this.findRouteUsageAt(document.uri.fsPath, position)?.routeName;

    if (!routeName) {
      return undefined;
    }

    const references: vscode.Location[] = [];

    if (includeDeclaration) {
      for (const routeDefinition of this.latestIndex.routes.filter((route) => route.name === routeName)) {
        references.push(
          new vscode.Location(vscode.Uri.file(routeDefinition.filePath), toVsCodeRange(routeDefinition.nameRange)),
        );
      }
    }

    for (const routeUsage of this.latestIndex.routeUsages.filter((usage) => usage.routeName === routeName)) {
      references.push(new vscode.Location(vscode.Uri.file(routeUsage.filePath), toVsCodeRange(routeUsage.range)));
    }

    return references;
  }

  public async provideTwigCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    await this.ensureIndex();

    const templatePath = this.getTemplatePathForDocument(document);

    if (!templatePath) {
      return [];
    }

    const codeLensRange = new vscode.Range(0, 0, 0, 0);
    const codeLenses: vscode.CodeLens[] = [];
    const controllerTargets = uniqueTargets(
      this.latestIndex.templateBindings
        .filter((binding) => binding.templatePath === templatePath)
        .map((binding) => templateBindingToTarget(binding)),
    );
    const formTargets = uniqueTargets(
      this.latestIndex.formBindings
        .filter((binding) => binding.templatePath === templatePath)
        .map((binding) => formBindingToTarget(binding)),
    );
    const crudTargets = uniqueTargets(
      this.latestIndex.themeBindings
        .filter((binding) => binding.themePath === templatePath)
        .map((binding) => themeBindingToTarget(binding)),
    );

    if (controllerTargets.length > 0) {
      codeLenses.push(
        new vscode.CodeLens(codeLensRange, buildCodeLensCommand(
          controllerTargets.length === 1 ? 'Open controller' : `Open controller (${controllerTargets.length})`,
          controllerTargets,
          'Choose a controller',
        )),
      );
    }

    if (formTargets.length > 0) {
      codeLenses.push(
        new vscode.CodeLens(codeLensRange, buildCodeLensCommand(
          formTargets.length === 1 ? 'Open form type' : `Open form type (${formTargets.length})`,
          formTargets,
          'Choose a form type',
        )),
      );
    }

    if (crudTargets.length > 0) {
      codeLenses.push(
        new vscode.CodeLens(codeLensRange, buildCodeLensCommand(
          crudTargets.length === 1 ? 'Open CRUD controller' : `Open CRUD controller (${crudTargets.length})`,
          crudTargets,
          'Choose a CRUD controller',
        )),
      );
    }

    return codeLenses;
  }

  public async provideTwigRouteCompletions(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.CompletionItem[]> {
    await this.ensureIndex();

    const text = document.getText();
    const offset = document.offsetAt(position);
    const routeCall = findTwigRouteCallAt(text, offset);

    if (!routeCall) {
      return [];
    }

    if (routeCall.routeNameRange && offset >= routeCall.routeNameRange.start && offset <= routeCall.routeNameRange.end) {
      return this.buildRouteNameCompletions(document, routeCall);
    }

    if (
      routeCall.routeName &&
      routeCall.paramsObjectRange &&
      offset >= routeCall.paramsObjectRange.start &&
      offset <= routeCall.paramsObjectRange.end
    ) {
      return this.buildRouteParamCompletions(document, position, routeCall.routeName, routeCall.existingParamKeys);
    }

    return [];
  }

  public async openTargets(targets: NavigationTarget[], quickPickTitle: string): Promise<void> {
    const unique = uniqueTargets(targets);

    if (unique.length === 0) {
      return;
    }

    if (unique.length === 1) {
      await this.openTarget(unique[0]);
      return;
    }

    const picked = await vscode.window.showQuickPick(
      unique.map((target) => ({
        label: target.label,
        description: target.description,
        target,
      })),
      {
        title: quickPickTitle,
        placeHolder: 'Choose a target to open',
      },
    );

    if (picked) {
      await this.openTarget(picked.target);
    }
  }

  public dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
  }

  private async doRefresh(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (!workspaceFolder) {
      this.latestIndex = createEmptySymfonyWebIndex();
      this.twigNamespacePaths = {};
      this.hasScanned = true;
      return;
    }

    this.latestIndex = await scanSymfonyWebWorkspace(workspaceFolder.uri.fsPath, {
      textOverrides: this.collectTextOverrides(),
    });
    this.twigNamespacePaths = await loadTwigNamespacePaths(workspaceFolder.uri.fsPath);
    this.hasScanned = true;
  }

  private async ensureIndex(): Promise<void> {
    if (!this.hasScanned) {
      await this.refresh();
    }
  }

  private collectTextOverrides(): Map<string, string> {
    const textOverrides = new Map<string, string>();

    for (const document of vscode.workspace.textDocuments) {
      if (document.uri.scheme !== 'file' || !isSymfonyWebRelevantDocument(document.uri.fsPath)) {
        continue;
      }

      textOverrides.set(path.normalize(document.uri.fsPath), document.getText());
    }

    return textOverrides;
  }

  private findRouteDefinitionAt(filePath: string, position: vscode.Position): RouteDefinition | undefined {
    const normalizedPath = path.normalize(filePath);

    return this.latestIndex.routes.find(
      (route) => path.normalize(route.filePath) === normalizedPath && rangeContains(route.nameRange, position),
    );
  }

  private findRouteUsageAt(filePath: string, position: vscode.Position): RouteUsage | undefined {
    const normalizedPath = path.normalize(filePath);

    return this.latestIndex.routeUsages.find(
      (usage) => path.normalize(usage.filePath) === normalizedPath && rangeContains(usage.range, position),
    );
  }

  private findTemplateBindingAt(filePath: string, position: vscode.Position): TemplateRenderBinding | undefined {
    const normalizedPath = path.normalize(filePath);

    return this.latestIndex.templateBindings.find(
      (binding) =>
        path.normalize(binding.controllerFilePath) === normalizedPath &&
        rangeContains(binding.renderRange, position),
    );
  }

  private findThemeBindingAt(filePath: string, position: vscode.Position): ThemeBinding | undefined {
    const normalizedPath = path.normalize(filePath);

    return this.latestIndex.themeBindings.find(
      (binding) =>
        path.normalize(binding.controllerFilePath) === normalizedPath &&
        rangeContains(binding.range, position),
    );
  }

  private findTwigFormTarget(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): NavigationTarget | undefined {
    const templatePath = this.getTemplatePathForDocument(document);

    if (!templatePath) {
      return undefined;
    }

    const text = document.getText();
    const chain = findTwigIdentifierChainAt(text, document.offsetAt(position));

    if (!chain || chain.segments.length === 0) {
      return undefined;
    }

    const formVariableSegment = chain.segments[0];
    const fieldSegment = chain.segments[1];
    const cursorOffset = document.offsetAt(position);
    const matchingBinding = this.latestIndex.formBindings.find(
      (binding) => binding.templatePath === templatePath && binding.formVariable === formVariableSegment.value,
    );

    if (!matchingBinding) {
      return undefined;
    }

    if (cursorOffset >= formVariableSegment.range.start && cursorOffset <= formVariableSegment.range.end) {
      return formBindingToTarget(matchingBinding);
    }

    if (
      fieldSegment &&
      !RESERVED_TWIG_FORM_SEGMENTS.has(fieldSegment.value) &&
      cursorOffset >= fieldSegment.range.start &&
      cursorOffset <= fieldSegment.range.end
    ) {
      const fieldDefinition = matchingBinding.fieldDefinitions.find((field) => field.name === fieldSegment.value);

      if (fieldDefinition) {
        return {
          filePath: matchingBinding.formTypeFilePath,
          range: fieldDefinition.range,
          label: `${matchingBinding.formTypeClass}::${fieldDefinition.name}`,
        };
      }

      return formBindingToTarget(matchingBinding);
    }

    return undefined;
  }

  private async findTwigResourceTarget(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<NavigationTarget | undefined> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);

    if (!workspaceFolder) {
      return undefined;
    }

    const text = document.getText();
    const pattern = /\b(source|asset)\s*\(\s*(['"])([^'"]+)\2/g;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      const resourceFunction = match[1];
      const sourceValue = match[3];

      if (!sourceValue) {
        continue;
      }

      const valueStart = match.index + match[0].indexOf(sourceValue);
      const valueEnd = valueStart + sourceValue.length;
      const range = new vscode.Range(document.positionAt(valueStart), document.positionAt(valueEnd));

      if (!range.contains(position)) {
        continue;
      }

      const resolvedPath = await this.resolveTwigResourceFilePath(
        workspaceFolder.uri.fsPath,
        sourceValue,
        resourceFunction === 'asset' ? 'asset' : 'source',
      );

      if (!resolvedPath) {
        return undefined;
      }

      return {
        filePath: resolvedPath,
        range: fromVsCodeRange(range),
        label: sourceValue,
      };
    }

    return undefined;
  }

  private buildRouteNameCompletions(
    document: vscode.TextDocument,
    routeCall: ReturnType<typeof findTwigRouteCallAt> extends infer T ? Exclude<T, undefined> : never,
  ): vscode.CompletionItem[] {
    const routeNameRange = routeCall.routeNameRange
      ? new vscode.Range(document.positionAt(routeCall.routeNameRange.start), document.positionAt(routeCall.routeNameRange.end))
      : undefined;

    return this.latestIndex.routes.map((route) => {
      const item = new vscode.CompletionItem(route.name, vscode.CompletionItemKind.Reference);
      const missingRequiredParams = route.requiredParams;

      item.detail = `${route.controllerClass}::${route.controllerMethod}`;
      item.sortText = `0-${route.name}`;

      if (routeNameRange) {
        item.range = routeNameRange;
      }

      if (missingRequiredParams.length > 0 && !routeCall.paramsObjectRange && routeCall.quote) {
        const snippets = missingRequiredParams.map((paramName, index) => routeParamSnippet(paramName, index + 1));
        item.insertText = new vscode.SnippetString(
          `${route.name}${routeCall.quote}, { ${snippets.join(', ')} }`,
        );
      } else {
        item.insertText = route.name;
      }

      return item;
    });
  }

  private buildRouteParamCompletions(
    document: vscode.TextDocument,
    position: vscode.Position,
    routeName: string,
    existingParamKeys: string[],
  ): vscode.CompletionItem[] {
    const route = this.latestIndex.routes.find((entry) => entry.name === routeName);

    if (!route) {
      return [];
    }

    const missingRequired = route.requiredParams.filter((paramName) => !existingParamKeys.includes(paramName));
    const missingOptional = route.optionalParams.filter((paramName) => !existingParamKeys.includes(paramName));
    const completionRange = document.getWordRangeAtPosition(position, /[_A-Za-z][_A-Za-z0-9]*/);
    const allParams = missingRequired.concat(missingOptional);

    return allParams.map((paramName, index) => {
      const item = new vscode.CompletionItem(paramName, vscode.CompletionItemKind.Property);

      item.detail = missingRequired.includes(paramName) ? 'Required route param' : 'Optional route param';
      item.sortText = `${missingRequired.includes(paramName) ? '0' : '1'}-${paramName}`;
      item.insertText = new vscode.SnippetString(routeParamSnippet(paramName, index + 1));

      if (completionRange) {
        item.range = completionRange;
      }

      return item;
    });
  }

  private resolveWorkspaceTemplateUri(templatePath: string): vscode.Uri | undefined {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (!workspaceFolder || templatePath.startsWith('@')) {
      return undefined;
    }

    return vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, 'templates', templatePath));
  }

  private getTemplatePathForDocument(document: vscode.TextDocument): string | undefined {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);

    if (!workspaceFolder) {
      return undefined;
    }

    return templatePathFromFilePath(workspaceFolder.uri.fsPath, document.uri.fsPath);
  }

  private async openTarget(target: NavigationTarget): Promise<void> {
    const document = await vscode.workspace.openTextDocument(target.filePath);

    await vscode.window.showTextDocument(document, {
      preview: false,
      selection: new vscode.Selection(
        toVsCodeRange(target.range).start,
        toVsCodeRange(target.range).end,
      ),
    });
  }

  private async resolveTwigResourceFilePath(
    workspaceRoot: string,
    sourcePath: string,
    kind: 'source' | 'asset',
  ): Promise<string | undefined> {
    const candidatePaths: string[] = [];
    const normalizedResourcePath = sourcePath.replace(/[?#].*$/, '').replace(/^\/+/, '');

    if (kind === 'asset') {
      if (normalizedResourcePath.startsWith('build/images/')) {
        candidatePaths.push(
          path.join(
            workspaceRoot,
            'assets',
            'images',
            ...normalizedResourcePath.slice('build/images/'.length).split('/'),
          ),
        );
      }

      candidatePaths.push(path.join(workspaceRoot, 'public', ...normalizedResourcePath.split('/')));
    } else if (sourcePath.startsWith('@')) {
      const match = /^@([^/]+)\/(.+)$/.exec(sourcePath);
      const namespace = match?.[1];
      const relativePath = match?.[2];
      const namespaceRoot = namespace ? this.twigNamespacePaths[namespace] : undefined;

      if (namespaceRoot && relativePath) {
        candidatePaths.push(path.join(namespaceRoot, ...relativePath.split('/')));
      }
    } else if (sourcePath.endsWith('.twig')) {
      candidatePaths.push(path.join(workspaceRoot, 'templates', ...sourcePath.split('/')));
    } else {
      candidatePaths.push(path.join(workspaceRoot, ...normalizedResourcePath.split('/')));
    }

    for (const candidatePath of candidatePaths) {
      try {
        await fs.access(candidatePath);
        return path.normalize(candidatePath);
      } catch {
        continue;
      }
    }

    return undefined;
  }
}

function rangeContains(range: TextRange, position: vscode.Position): boolean {
  const start = toVsCodePosition(range.start);
  const end = toVsCodePosition(range.end);

  return position.isAfterOrEqual(start) && position.isBeforeOrEqual(end);
}

function toVsCodeRange(range: TextRange): vscode.Range {
  return new vscode.Range(toVsCodePosition(range.start), toVsCodePosition(range.end));
}

function fromVsCodeRange(range: vscode.Range): TextRange {
  return {
    start: {
      line: range.start.line,
      character: range.start.character,
    },
    end: {
      line: range.end.line,
      character: range.end.character,
    },
  };
}

function toVsCodePosition(position: TextRange['start']): vscode.Position {
  return new vscode.Position(position.line, position.character);
}

function zeroTextRange(): TextRange {
  return {
    start: {
      line: 0,
      character: 0,
    },
    end: {
      line: 0,
      character: 0,
    },
  };
}

function templateBindingToTarget(binding: TemplateRenderBinding): NavigationTarget {
  return {
    filePath: binding.controllerFilePath,
    range: binding.renderRange,
    label: `${binding.controllerClass}::${binding.controllerMethod}`,
    description: binding.templatePath,
  };
}

function formBindingToTarget(binding: FormBinding): NavigationTarget {
  return {
    filePath: binding.formTypeFilePath,
    range: binding.formTypeRange,
    label: binding.formTypeClass,
    description: binding.formVariable,
  };
}

function themeBindingToTarget(binding: ThemeBinding): NavigationTarget {
  return {
    filePath: binding.controllerFilePath,
    range: binding.range,
    label: `${binding.controllerClass}::${binding.controllerMethod}`,
    description: binding.themePath,
  };
}

function uniqueTargets(targets: NavigationTarget[]): NavigationTarget[] {
  const seen = new Set<string>();
  const unique: NavigationTarget[] = [];

  for (const target of targets) {
    const key = `${path.normalize(target.filePath)}:${target.range.start.line}:${target.range.start.character}:${target.label}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(target);
  }

  return unique;
}

function buildCodeLensCommand(
  title: string,
  targets: NavigationTarget[],
  quickPickTitle: string,
): vscode.Command {
  return {
    title,
    command: 'symfonyDevTools.internal.openWebTargets',
    arguments: [targets, quickPickTitle],
  };
}

function buildLocationLink(
  originRange: TextRange,
  targetFilePath: string,
  targetRange: TextRange,
): vscode.LocationLink {
  return {
    originSelectionRange: toVsCodeRange(originRange),
    targetUri: vscode.Uri.file(targetFilePath),
    targetRange: toVsCodeRange(targetRange),
    targetSelectionRange: toVsCodeRange(targetRange),
  };
}
