import * as vscode from 'vscode';

import { TranslationAuditController } from './auditController';

export class TranslationDefinitionProvider implements vscode.DefinitionProvider {
  public constructor(private readonly auditController: TranslationAuditController) {}

  public async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Definition | vscode.DefinitionLink[] | undefined> {
    let usage = this.auditController.findStaticUsageAt(document.uri.fsPath, position);

    if (!usage && !this.auditController.hasScanned()) {
      await this.auditController.refresh();
      usage = this.auditController.findStaticUsageAt(document.uri.fsPath, position);
    }

    if (!usage) {
      return undefined;
    }

    const definition = this.auditController.getPreferredDefinitionForUsage(usage, document.uri.fsPath);

    if (!definition) {
      return undefined;
    }

    return [
      {
        originSelectionRange: usage.range,
        targetUri: vscode.Uri.file(definition.filePath),
        targetRange: definition.range,
        targetSelectionRange: definition.range,
      },
    ];
  }
}
