import * as vscode from 'vscode';

import { SymfonyWebController } from './controller';

export class SymfonyWebDefinitionProvider implements vscode.DefinitionProvider {
  public constructor(private readonly controller: SymfonyWebController) {}

  public async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Definition | vscode.DefinitionLink[] | undefined> {
    return this.controller.findDefinition(document, position);
  }
}
