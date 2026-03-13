import * as vscode from 'vscode';

export type TranslationIssueKind = 'missing' | 'unused' | 'dynamic' | 'parseError' | 'todo';
export type TranslationIssueSeverity = 'error' | 'warning';
export type TranslationSourceLanguage = 'php' | 'twig' | 'yaml';
export type TranslationDirectiveKind = 'markUsed' | 'ignoreMissing';

export interface TranslationDefinition {
  id: string;
  domain: string;
  locale: string;
  key: string;
  filePath: string;
  range: vscode.Range;
  value: string | null;
  hasTodoMarker: boolean;
}

export interface TranslationUsage {
  id: string;
  sourceLanguage: TranslationSourceLanguage;
  filePath: string;
  range: vscode.Range;
  domain: string;
  key: string | undefined;
  defaultDomain: string;
  isDynamic: boolean;
  rawText: string;
}

export interface TranslationDirective {
  kind: TranslationDirectiveKind;
  sourceLanguage: Exclude<TranslationSourceLanguage, 'yaml'>;
  filePath: string;
  domain: string;
  pattern: string;
  range: vscode.Range;
}

export interface TranslationIssue {
  id: string;
  kind: TranslationIssueKind;
  severity: TranslationIssueSeverity;
  message: string;
  sourceFilePath: string;
  sourceRange: vscode.Range;
  domain?: string;
  locale?: string;
  key?: string;
  relatedFilePath?: string;
  relatedRange?: vscode.Range;
  usageId?: string;
  definitionId?: string;
}

export interface TranslationSummary {
  domains: string[];
  locales: string[];
  missingCount: number;
  unusedCount: number;
  dynamicCount: number;
  parseErrorCount: number;
  todoCount: number;
  issueCount: number;
}

export interface TranslationAuditModel {
  generatedAt: string;
  definitions: TranslationDefinition[];
  usages: TranslationUsage[];
  directives: TranslationDirective[];
  issues: TranslationIssue[];
  summary: TranslationSummary;
}

export interface TranslationStateSnapshot {
  generatedAt?: string;
  summary: TranslationSummary;
  issues: TranslationIssue[];
}

export interface TranslationSyncOperation {
  type: 'add-missing' | 'delete-unused';
  description: string;
  filePath: string;
  domain: string;
  locale?: string;
  key: string;
  issueIds: string[];
}

export interface TranslationSyncPlan {
  generatedAt: string;
  operations: TranslationSyncOperation[];
  preview: string;
}

export interface TranslationParseError {
  message: string;
  filePath: string;
  range: vscode.Range;
}

export function createEmptyTranslationSummary(): TranslationSummary {
  return {
    domains: [],
    locales: [],
    missingCount: 0,
    unusedCount: 0,
    dynamicCount: 0,
    parseErrorCount: 0,
    todoCount: 0,
    issueCount: 0,
  };
}

export function createEmptyTranslationAuditModel(): TranslationAuditModel {
  return {
    generatedAt: new Date(0).toISOString(),
    definitions: [],
    usages: [],
    directives: [],
    issues: [],
    summary: createEmptyTranslationSummary(),
  };
}
