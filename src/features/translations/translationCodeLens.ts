import * as path from 'node:path';

import * as vscode from 'vscode';

import { COMMANDS } from '../../constants';
import { TranslationAuditController } from './auditController';

export class TranslationCodeLensProvider implements vscode.CodeLensProvider {
  private readonly onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();

  public constructor(private readonly auditController: TranslationAuditController) {}

  public readonly onDidChangeCodeLenses = this.onDidChangeCodeLensesEmitter.event;

  public refresh(): void {
    this.onDidChangeCodeLensesEmitter.fire();
  }

  public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!isTranslationDocument(document)) {
      return [];
    }

    const definitions = this.auditController.getDefinitionsForFile(document.uri.fsPath);
    const codeLenses: vscode.CodeLens[] = [];

    for (const definition of definitions) {
      const peers = this.auditController.getPeerDefinitions(definition);

      for (const peer of peers) {
        codeLenses.push(
          new vscode.CodeLens(definition.range, {
            command: COMMANDS.openTranslationPeer,
            title: `Open ${peer.locale}`,
            arguments: [
              {
                filePath: definition.filePath,
                key: definition.key,
                targetLocale: peer.locale,
              },
            ],
          }),
        );
      }
    }

    return codeLenses;
  }
}

function isTranslationDocument(document: vscode.TextDocument): boolean {
  if (document.uri.scheme !== 'file' || document.languageId !== 'yaml') {
    return false;
  }

  const normalizedPath = path.normalize(document.uri.fsPath);

  return normalizedPath.includes(`${path.sep}translations${path.sep}`);
}
