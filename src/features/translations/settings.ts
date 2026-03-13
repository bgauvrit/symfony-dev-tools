import * as vscode from 'vscode';

import { EXTENSION_NAMESPACE } from '../../constants';

export interface TranslationSettings {
  referenceLocale: string;
  translationSyncMode: 'create-empty';
  enableTranslationDiagnostics: boolean;
  enableTranslationReport: boolean;
  ignoredTranslationFiles: string[];
}

export function getTranslationSettings(scope?: vscode.ConfigurationScope): TranslationSettings {
  const configuration = vscode.workspace.getConfiguration(EXTENSION_NAMESPACE, scope);
  const referenceLocale = configuration.get<string>('referenceLocale', 'fr').trim();
  const translationSyncMode = configuration.get<'create-empty'>('translationSyncMode', 'create-empty');
  const ignoredTranslationFiles = (configuration.get<string[]>('ignoredTranslationFiles', []) ?? [])
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0);

  return {
    referenceLocale: referenceLocale.length > 0 ? referenceLocale : 'fr',
    translationSyncMode,
    enableTranslationDiagnostics: configuration.get<boolean>('enableTranslationDiagnostics', true),
    enableTranslationReport: configuration.get<boolean>('enableTranslationReport', true),
    ignoredTranslationFiles,
  };
}
