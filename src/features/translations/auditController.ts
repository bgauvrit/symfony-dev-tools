import * as path from 'node:path';

import * as vscode from 'vscode';

import { COMMANDS, VIEW_IDS } from '../../constants';
import {
  createEmptyTranslationAuditModel,
  type TranslationDefinition,
  type TranslationIssue,
  type TranslationStateSnapshot,
  type TranslationSyncPlan,
  type TranslationUsage,
} from './model';
import { TranslationReportViewProvider } from './reportView';
import { scanTranslationWorkspace, type TranslationWorkspaceState } from './scanner';
import { getTranslationSettings } from './settings';
import { applyTranslationSyncPlan, buildTranslationSyncPlan } from './sync';

export class TranslationAuditController implements vscode.Disposable {
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('symfonyDevTools.translations');
  private readonly reportViewProvider = new TranslationReportViewProvider();
  private latestWorkspaceState: TranslationWorkspaceState = {
    audit: createEmptyTranslationAuditModel(),
    translationFiles: [],
  };
  private hasCompletedRefresh = false;
  private refreshTimer: NodeJS.Timeout | undefined;

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly onStateChanged: () => void,
  ) {}

  public getReportViewProvider(): TranslationReportViewProvider {
    return this.reportViewProvider;
  }

  public hasScanned(): boolean {
    return this.hasCompletedRefresh;
  }

  public getStateSnapshot(): TranslationStateSnapshot {
    return {
      generatedAt: this.latestWorkspaceState.audit.generatedAt,
      summary: this.latestWorkspaceState.audit.summary,
      issues: this.latestWorkspaceState.audit.issues,
    };
  }

  public getIssue(issueId: string): TranslationIssue | undefined {
    return this.latestWorkspaceState.audit.issues.find((issue) => issue.id === issueId);
  }

  public getDefinitionsForFile(filePath: string): TranslationDefinition[] {
    return this.latestWorkspaceState.audit.definitions.filter((definition) => definition.filePath === filePath);
  }

  public findStaticUsageAt(filePath: string, position: vscode.Position): TranslationUsage | undefined {
    const normalizedFilePath = path.normalize(filePath);

    return this.latestWorkspaceState.audit.usages.find(
      (usage) =>
        path.normalize(usage.filePath) === normalizedFilePath &&
        !usage.isDynamic &&
        Boolean(usage.key) &&
        usage.range.contains(position),
    );
  }

  public getPreferredDefinitionForUsage(
    usage: TranslationUsage,
    filePath: string,
  ): TranslationDefinition | undefined {
    if (!usage.key) {
      return undefined;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
    const referenceLocale = workspaceFolder ? getTranslationSettings(workspaceFolder).referenceLocale : 'fr';
    const matchingDefinitions = this.latestWorkspaceState.audit.definitions
      .filter((definition) => definition.domain === usage.domain && definition.key === usage.key)
      .sort((left, right) => left.locale.localeCompare(right.locale));

    if (matchingDefinitions.length === 0) {
      return undefined;
    }

    return (
      matchingDefinitions.find((definition) => definition.locale === referenceLocale) ?? matchingDefinitions[0]
    );
  }

  public getPeerDefinitions(definition: TranslationDefinition): TranslationDefinition[] {
    return this.latestWorkspaceState.audit.definitions
      .filter(
        (entry) =>
          entry.domain === definition.domain &&
          entry.key === definition.key &&
          entry.locale !== definition.locale,
      )
      .sort((left, right) => left.locale.localeCompare(right.locale));
  }

  public async refresh(showNotification = false): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (!workspaceFolder) {
      this.latestWorkspaceState = {
        audit: createEmptyTranslationAuditModel(),
        translationFiles: [],
      };
      this.applyDiagnostics();
      this.reportViewProvider.setSnapshot(this.getStateSnapshot());
      this.onStateChanged();
      this.hasCompletedRefresh = true;
      return;
    }

    const settings = getTranslationSettings(workspaceFolder);

    this.latestWorkspaceState = await scanTranslationWorkspace(workspaceFolder.uri.fsPath, {
      referenceLocale: settings.referenceLocale,
      ignoredTranslationFiles: settings.ignoredTranslationFiles,
      textOverrides: this.collectTextOverrides(),
    });
    this.applyDiagnostics();
    this.reportViewProvider.setSnapshot(this.getStateSnapshot());
    this.onStateChanged();
    this.hasCompletedRefresh = true;

    if (showNotification) {
      void vscode.window.showInformationMessage(
        `Translation scan complete: ${this.latestWorkspaceState.audit.summary.issueCount} issue(s).`,
      );
    }
  }

  public async openReport(): Promise<void> {
    await vscode.commands.executeCommand(`workbench.view.extension.${VIEW_IDS.container}`);
    await vscode.commands.executeCommand(`${VIEW_IDS.translations}.focus`);
    await this.refresh();
  }

  public scheduleRefreshForDocument(document: vscode.TextDocument): void {
    if (document.uri.scheme !== 'file' || !isTranslationRelevantDocument(document.uri.fsPath)) {
      return;
    }

    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    this.refreshTimer = setTimeout(() => {
      void this.refresh();
    }, 200);
  }

  public async openIssue(issueId: string): Promise<void> {
    const issue = this.getIssue(issueId);

    if (!issue) {
      return;
    }

    const document = await vscode.workspace.openTextDocument(issue.sourceFilePath);

    await vscode.window.showTextDocument(document, {
      preview: false,
      selection: new vscode.Selection(issue.sourceRange.start, issue.sourceRange.end),
    });
  }

  public async openPeerTranslation(args: {
    filePath: string;
    key: string;
    targetLocale: string;
  }): Promise<void> {
    const currentDefinition = this.latestWorkspaceState.audit.definitions.find(
      (definition) => definition.filePath === args.filePath && definition.key === args.key,
    );

    if (!currentDefinition) {
      return;
    }

    const peerDefinition = this.latestWorkspaceState.audit.definitions.find(
      (definition) =>
        definition.domain === currentDefinition.domain &&
        definition.key === currentDefinition.key &&
        definition.locale === args.targetLocale,
    );

    if (!peerDefinition) {
      void vscode.window.showWarningMessage(
        `No ${args.targetLocale} translation found for "${currentDefinition.key}".`,
      );
      return;
    }

    const document = await vscode.workspace.openTextDocument(peerDefinition.filePath);

    await vscode.window.showTextDocument(document, {
      preview: false,
      selection: new vscode.Selection(peerDefinition.range.start, peerDefinition.range.end),
    });
  }

  public async syncTranslations(
    issueIds?: string[],
    options: {
      skipPreview?: boolean;
      skipConfirmation?: boolean;
    } = {},
  ): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (!workspaceFolder) {
      void vscode.window.showWarningMessage('Open a Symfony workspace before syncing translations.');
      return;
    }

    if (this.latestWorkspaceState.audit.generatedAt === createEmptyTranslationAuditModel().generatedAt) {
      await this.refresh();
    }

    const fullPlan = buildTranslationSyncPlan(workspaceFolder.uri.fsPath, this.latestWorkspaceState);
    const plan = issueIds && issueIds.length > 0 ? filterSyncPlan(fullPlan, issueIds) : fullPlan;

    if (plan.operations.length === 0) {
      void vscode.window.showInformationMessage('No translation changes are required.');
      return;
    }

    if (!options.skipPreview) {
      const previewDocument = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content: plan.preview,
      });

      await vscode.window.showTextDocument(previewDocument, { preview: false });
    }

    if (!options.skipConfirmation) {
      const choice = await vscode.window.showInformationMessage(
        `Apply ${plan.operations.length} translation change(s)?`,
        'Apply',
        'Cancel',
      );

      if (choice !== 'Apply') {
        return;
      }
    }

    await applyTranslationSyncPlan(this.latestWorkspaceState, plan);
    await this.refresh(true);
  }

  public async applyFix(issueId: string): Promise<void> {
    const issue = this.getIssue(issueId);

    if (!issue) {
      return;
    }

    if (issue.kind === 'dynamic') {
      await this.insertDirective(issue, {
        directiveName: 'mark-used',
        pattern: '*',
      });
      await this.refresh(true);
      return;
    }

    await this.syncTranslations([issueId], {
      skipPreview: true,
      skipConfirmation: true,
    });
  }

  public async applyAnnotationFix(issueId: string): Promise<void> {
    const issue = this.getIssue(issueId);

    if (!issue || !issue.domain) {
      return;
    }

    if (issue.kind === 'dynamic') {
      await this.insertDirective(issue, {
        directiveName: 'mark-used',
        pattern: '*',
      });
      await this.refresh(true);
      return;
    }

    if (issue.kind === 'missing' && issue.key) {
      await this.insertDirective(issue, {
        directiveName: 'ignore-missing',
        pattern: issue.key,
      });
      await this.refresh(true);
    }
  }

  public dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    this.diagnostics.dispose();
  }

  private collectTextOverrides(): Map<string, string> {
    const textOverrides = new Map<string, string>();

    for (const document of vscode.workspace.textDocuments) {
      if (document.uri.scheme !== 'file' || !isTranslationRelevantDocument(document.uri.fsPath)) {
        continue;
      }

      textOverrides.set(path.normalize(document.uri.fsPath), document.getText());
    }

    return textOverrides;
  }

  private applyDiagnostics(): void {
    this.diagnostics.clear();

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (!workspaceFolder) {
      return;
    }

    const settings = getTranslationSettings(workspaceFolder);

    if (!settings.enableTranslationDiagnostics) {
      return;
    }

    const diagnosticsByFile = new Map<string, vscode.Diagnostic[]>();

    for (const issue of this.latestWorkspaceState.audit.issues) {
      const fileDiagnostics = diagnosticsByFile.get(issue.sourceFilePath) ?? [];
      const diagnostic = new vscode.Diagnostic(
        issue.sourceRange,
        issue.message,
        issue.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning,
      );

      diagnostic.source = 'symfonyDevTools.translations';
      diagnostic.code = issue.id;
      fileDiagnostics.push(diagnostic);
      diagnosticsByFile.set(issue.sourceFilePath, fileDiagnostics);
    }

    for (const [filePath, diagnostics] of diagnosticsByFile.entries()) {
      this.diagnostics.set(vscode.Uri.file(filePath), diagnostics);
    }
  }

  private async insertDirective(
    issue: TranslationIssue,
    options: {
      directiveName: 'mark-used' | 'ignore-missing';
      pattern: string;
    },
  ): Promise<void> {
    const document = await vscode.workspace.openTextDocument(issue.sourceFilePath);
    const lineStart = new vscode.Position(issue.sourceRange.start.line, 0);
    const currentLine = document.lineAt(issue.sourceRange.start.line).text;
    const indentation = currentLine.match(/^\s*/)?.[0] ?? '';
    const directive =
      path.extname(issue.sourceFilePath).toLowerCase() === '.twig'
        ? `${indentation}{# symfony-dev-tools:${options.directiveName} ${issue.domain}:${options.pattern} #}\n`
        : `${indentation}// symfony-dev-tools:${options.directiveName} ${issue.domain}:${options.pattern}\n`;
    const edit = new vscode.WorkspaceEdit();

    edit.insert(document.uri, lineStart, directive);
    await vscode.workspace.applyEdit(edit);
    await document.save();
  }
}

function filterSyncPlan(plan: TranslationSyncPlan, issueIds: string[]): TranslationSyncPlan {
  const issueIdSet = new Set(issueIds);
  const filteredOperations = plan.operations.filter((operation) =>
    operation.issueIds.some((issueId) => issueIdSet.has(issueId)),
  );

  return {
    generatedAt: plan.generatedAt,
    operations: filteredOperations,
    preview: filteredOperations.length === 0
      ? '# Translation Sync Preview\n\nNo translation changes are required.\n'
      : [
          '# Translation Sync Preview',
          '',
          ...filteredOperations.map((operation) => `- [${operation.type}] ${operation.description}`),
          '',
        ].join('\n'),
  };
}

function isTranslationRelevantDocument(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();

  return extension === '.php' || extension === '.twig' || extension === '.yaml' || extension === '.yml';
}
