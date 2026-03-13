import * as vscode from 'vscode';

import { SymfonyWebController } from './controller';

export class SymfonyTwigCodeLensProvider implements vscode.CodeLensProvider {
  private readonly onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();

  public readonly onDidChangeCodeLenses = this.onDidChangeCodeLensesEmitter.event;

  public constructor(private readonly controller: SymfonyWebController) {}

  public refresh(): void {
    this.onDidChangeCodeLensesEmitter.fire();
  }

  public async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    return this.controller.provideTwigCodeLenses(document);
  }
}
