import * as vscode from 'vscode';

import { SymfonyWebController } from './controller';

export class SymfonyTwigRouteCompletionProvider implements vscode.CompletionItemProvider {
  public constructor(private readonly controller: SymfonyWebController) {}

  public async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.CompletionItem[]> {
    return this.controller.provideTwigRouteCompletions(document, position);
  }
}
