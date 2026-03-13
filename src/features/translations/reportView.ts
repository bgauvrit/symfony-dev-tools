import * as path from 'node:path';

import * as vscode from 'vscode';

import { COMMANDS } from '../../constants';
import type { TranslationIssue, TranslationStateSnapshot } from './model';

interface TranslationReportDescriptor {
  id: string;
  label: string;
  description?: string;
  detail?: string;
  kind: 'group' | 'issue' | 'placeholder' | 'command';
  iconName?: string;
  iconColor?: string;
  issueId?: string;
  commandId?: string;
  commandArguments?: unknown[];
  children?: TranslationReportDescriptor[];
}

class TranslationReportTreeItem extends vscode.TreeItem {
  public constructor(public readonly descriptor: TranslationReportDescriptor) {
    super(
      descriptor.label,
      descriptor.kind === 'group'
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );

    this.id = descriptor.id;
    this.description = descriptor.description;
    this.tooltip = descriptor.detail ?? descriptor.description ?? descriptor.label;
    this.contextValue = descriptor.kind;
    this.iconPath = new vscode.ThemeIcon(
      descriptor.iconName ?? getDefaultIcon(descriptor.kind),
      descriptor.iconColor ? new vscode.ThemeColor(descriptor.iconColor) : undefined,
    );

    if (descriptor.kind === 'issue' && descriptor.issueId) {
      this.command = {
        command: COMMANDS.openTranslationIssue,
        title: descriptor.label,
        arguments: [descriptor.issueId],
      };
    } else if (descriptor.kind === 'command' && descriptor.commandId) {
      this.command = {
        command: descriptor.commandId,
        title: descriptor.label,
        arguments: descriptor.commandArguments ?? [],
      };
    }
  }
}

export class TranslationReportViewProvider implements vscode.TreeDataProvider<TranslationReportTreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<TranslationReportTreeItem | void>();
  private snapshot: TranslationStateSnapshot = {
    summary: {
      domains: [],
      locales: [],
      missingCount: 0,
      unusedCount: 0,
      dynamicCount: 0,
      parseErrorCount: 0,
      todoCount: 0,
      issueCount: 0,
    },
    issues: [],
  };

  public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  public setSnapshot(snapshot: TranslationStateSnapshot): void {
    this.snapshot = snapshot;
    this.onDidChangeTreeDataEmitter.fire();
  }

  public getTreeItem(element: TranslationReportTreeItem): vscode.TreeItem {
    return element;
  }

  public getChildren(element?: TranslationReportTreeItem): TranslationReportTreeItem[] {
    const descriptors = element?.descriptor.children ?? this.buildRootDescriptors();

    return descriptors.map((descriptor) => new TranslationReportTreeItem(descriptor));
  }

  private buildRootDescriptors(): TranslationReportDescriptor[] {
    const rootDescriptors: TranslationReportDescriptor[] = [
      {
        id: 'translations:command:sync',
        label: 'Sync translations',
        description: 'Preview and apply missing or unused translation fixes',
        kind: 'command',
        iconName: 'sync',
        iconColor: 'charts.green',
        commandId: COMMANDS.syncTranslations,
      },
    ];

    if (this.snapshot.issues.length === 0) {
      return [
        ...rootDescriptors,
        {
          id: 'translations:ok',
          label: 'No translation issues detected',
          description: 'Translation audit is already up to date.',
          kind: 'placeholder',
          iconName: 'pass-filled',
          iconColor: 'charts.green',
        },
      ];
    }

    const groups: Array<{
      kind: TranslationIssue['kind'];
      label: string;
      iconName: string;
      iconColor: string;
    }> = [
      { kind: 'missing', label: 'Missing', iconName: 'error', iconColor: 'problemsErrorIcon.foreground' },
      { kind: 'todo', label: 'Auto-generated / TODO', iconName: 'note', iconColor: 'problemsErrorIcon.foreground' },
      { kind: 'unused', label: 'Unused', iconName: 'trash', iconColor: 'charts.orange' },
      { kind: 'dynamic', label: 'Dynamic / Unresolved', iconName: 'warning', iconColor: 'problemsWarningIcon.foreground' },
      { kind: 'parseError', label: 'Parse errors', iconName: 'debug-disconnect', iconColor: 'problemsErrorIcon.foreground' },
    ];

    return [
      ...rootDescriptors,
      ...groups
        .map((group) => this.buildKindGroup(group.kind, group.label, group.iconName, group.iconColor))
        .filter((descriptor): descriptor is TranslationReportDescriptor => Boolean(descriptor)),
    ];
  }

  private buildKindGroup(
    kind: TranslationIssue['kind'],
    label: string,
    iconName: string,
    iconColor: string,
  ): TranslationReportDescriptor | undefined {
    const issues = this.snapshot.issues.filter((issue) => issue.kind === kind);

    if (issues.length === 0) {
      return undefined;
    }

    const issuesByDomain = new Map<string, TranslationIssue[]>();

    for (const issue of issues) {
      const domain = issue.domain ?? 'workspace';
      const domainIssues = issuesByDomain.get(domain) ?? [];
      domainIssues.push(issue);
      issuesByDomain.set(domain, domainIssues);
    }

    return {
      id: `translations:${kind}`,
      label,
      description: `${issues.length}`,
      kind: 'group',
      iconName,
      iconColor,
      children: Array.from(issuesByDomain.entries())
        .sort((left, right) => left[0].localeCompare(right[0]))
        .map(([domain, domainIssues]) => ({
          id: `translations:${kind}:${domain}`,
          label: domain,
          description: `${domainIssues.length}`,
          kind: 'group',
          iconName: 'symbol-key',
          children: buildLocaleGroups(kind, domain, domainIssues),
        })),
    };
  }
}

function buildLocaleGroups(
  kind: TranslationIssue['kind'],
  domain: string,
  issues: TranslationIssue[],
): TranslationReportDescriptor[] {
  const issuesByLocale = new Map<string, TranslationIssue[]>();

  for (const issue of issues) {
    const locale = issue.locale ?? 'all';
    const localeIssues = issuesByLocale.get(locale) ?? [];
    localeIssues.push(issue);
    issuesByLocale.set(locale, localeIssues);
  }

  return Array.from(issuesByLocale.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([locale, localeIssues]) => ({
      id: `translations:${kind}:${domain}:${locale}`,
      label: locale,
      description: `${localeIssues.length}`,
      kind: 'group',
      iconName: 'globe',
      children: localeIssues
        .sort((left, right) => {
          const leftKey = `${left.key ?? ''}:${left.sourceFilePath}:${left.sourceRange.start.line}`;
          const rightKey = `${right.key ?? ''}:${right.sourceFilePath}:${right.sourceRange.start.line}`;

          return leftKey.localeCompare(rightKey);
        })
        .map((issue) => ({
          id: `translations:issue:${issue.id}:${issue.sourceRange.start.line}:${issue.sourceRange.start.character}`,
          label: issue.key ?? path.basename(issue.sourceFilePath),
          description: `${path.basename(issue.sourceFilePath)}:${issue.sourceRange.start.line + 1}`,
          detail: issue.message,
          kind: 'issue',
          iconName: issue.severity === 'error' ? 'error' : 'warning',
          iconColor:
            issue.severity === 'error' ? 'problemsErrorIcon.foreground' : 'problemsWarningIcon.foreground',
          issueId: issue.id,
        })),
    }));
}

function getDefaultIcon(kind: TranslationReportDescriptor['kind']): string {
  if (kind === 'issue') {
    return 'warning';
  }

  if (kind === 'command') {
    return 'play';
  }

  if (kind === 'group') {
    return 'folder-library';
  }

  return 'info';
}
