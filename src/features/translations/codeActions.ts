import * as vscode from 'vscode';

import { COMMANDS } from '../../constants';
import type { TranslationAuditController } from './auditController';

export class TranslationCodeActionProvider implements vscode.CodeActionProvider {
  public constructor(private readonly auditController: TranslationAuditController) {}

  public provideCodeActions(
    _document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source !== 'symfonyDevTools.translations' || typeof diagnostic.code !== 'string') {
        continue;
      }

      const issue = this.auditController.getIssue(diagnostic.code);

      if (!issue) {
        continue;
      }

      if (issue.kind === 'missing') {
        actions.push(
          buildCommandAction(
            `Add missing translation "${issue.key}"`,
            diagnostic,
            COMMANDS.applyTranslationFix,
            issue.id,
            vscode.CodeActionKind.QuickFix,
          ),
        );
        actions.push(
          buildCommandAction(
            `Ignore missing translation "${issue.key}" with annotation`,
            diagnostic,
            COMMANDS.applyTranslationAnnotationFix,
            issue.id,
            vscode.CodeActionKind.QuickFix,
          ),
        );
      }

      if (issue.kind === 'unused') {
        actions.push(
          buildCommandAction(
            `Delete unused translation "${issue.key}"`,
            diagnostic,
            COMMANDS.applyTranslationFix,
            issue.id,
            vscode.CodeActionKind.QuickFix,
          ),
        );
      }

      if (issue.kind === 'dynamic') {
        actions.push(
          buildCommandAction(
            'Mark dynamic translation usage with annotation',
            diagnostic,
            COMMANDS.applyTranslationAnnotationFix,
            issue.id,
            vscode.CodeActionKind.QuickFix,
          ),
        );
      }
    }

    return actions;
  }
}

function buildCommandAction(
  title: string,
  diagnostic: vscode.Diagnostic,
  command: string,
  issueId: string,
  kind: vscode.CodeActionKind,
): vscode.CodeAction {
  const action = new vscode.CodeAction(title, kind);

  action.diagnostics = [diagnostic];
  action.command = {
    command,
    title,
    arguments: [issueId],
  };

  return action;
}
