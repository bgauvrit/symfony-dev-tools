import * as vscode from 'vscode';

import { SymfonyWebController } from './controller';

export class SymfonyWebReferenceProvider implements vscode.ReferenceProvider {
  public constructor(private readonly controller: SymfonyWebController) {}

  public async provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.ReferenceContext,
  ): Promise<vscode.Location[] | undefined> {
    return this.controller.findReferences(document, position, context.includeDeclaration);
  }
}
