import * as path from 'node:path';

import * as vscode from 'vscode';

import type { TranslationIssue, TranslationSyncOperation, TranslationSyncPlan } from './model';
import type { TranslationFileState, TranslationWorkspaceState } from './scanner';

const TRANSLATION_TODO_MARKER = 'symfony-dev-tools:todo';

export function buildTranslationSyncPlan(
  workspaceRoot: string,
  workspaceState: TranslationWorkspaceState,
): TranslationSyncPlan {
  const operations = new Map<string, TranslationSyncOperation>();
  const fileVariants = new Map(
    workspaceState.translationFiles.map((fileState) => [
      fileState.domain,
      {
        formatSuffix: fileState.formatSuffix,
        extension: fileState.extension,
      },
    ]),
  );

  for (const issue of workspaceState.audit.issues) {
    if (issue.kind === 'missing' && issue.domain && issue.key) {
      const locales = (issue.locale ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);

      for (const locale of locales) {
        const existingFile = workspaceState.translationFiles.find(
          (fileState) => fileState.domain === issue.domain && fileState.locale === locale,
        );
        const variant = fileVariants.get(issue.domain) ?? {
          formatSuffix: '',
          extension: '.yaml' as const,
        };
        const filePath =
          existingFile?.filePath
          ?? path.join(workspaceRoot, 'translations', `${issue.domain}${variant.formatSuffix}.${locale}${variant.extension}`);
        const operationKey = ['add-missing', filePath, issue.domain, locale, issue.key].join('|');

        operations.set(operationKey, {
          type: 'add-missing',
          description: `Add "${issue.key}" to ${issue.domain}.${locale}`,
          filePath,
          domain: issue.domain,
          locale,
          key: issue.key,
          issueIds: [...(operations.get(operationKey)?.issueIds ?? []), issue.id],
        });
      }
    }

    if (issue.kind === 'unused' && issue.domain && issue.locale && issue.key && issue.relatedFilePath) {
      const operationKey = ['delete-unused', issue.relatedFilePath, issue.domain, issue.locale, issue.key].join('|');

      operations.set(operationKey, {
        type: 'delete-unused',
        description: `Delete "${issue.key}" from ${issue.domain}.${issue.locale}`,
        filePath: issue.relatedFilePath,
        domain: issue.domain,
        locale: issue.locale,
        key: issue.key,
        issueIds: [...(operations.get(operationKey)?.issueIds ?? []), issue.id],
      });
    }
  }

  const sortedOperations = Array.from(operations.values()).sort((left, right) =>
    `${left.type}:${left.filePath}:${left.key}`.localeCompare(`${right.type}:${right.filePath}:${right.key}`),
  );

  return {
    generatedAt: workspaceState.audit.generatedAt,
    operations: sortedOperations,
    preview: buildSyncPreview(sortedOperations),
  };
}

export async function applyTranslationSyncPlan(
  workspaceState: TranslationWorkspaceState,
  plan: TranslationSyncPlan,
): Promise<void> {
  const operationsByFile = new Map<string, TranslationSyncOperation[]>();

  for (const operation of plan.operations) {
    const fileOperations = operationsByFile.get(operation.filePath) ?? [];
    fileOperations.push(operation);
    operationsByFile.set(operation.filePath, fileOperations);
  }

  const edit = new vscode.WorkspaceEdit();

  for (const [filePath, fileOperations] of operationsByFile.entries()) {
    const fileState = workspaceState.translationFiles.find((entry) => entry.filePath === filePath);
    const originalText = fileState?.text ?? '';
    const nextText = applyFileOperations(filePath, originalText, fileState, fileOperations);
    const uri = vscode.Uri.file(filePath);

    if (!fileState) {
      edit.createFile(uri, {
        ignoreIfExists: true,
      });
      edit.insert(uri, new vscode.Position(0, 0), nextText);
      continue;
    }

    const document = await vscode.workspace.openTextDocument(uri);
    const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));

    edit.replace(uri, fullRange, nextText);
  }

  await vscode.workspace.applyEdit(edit);

  for (const filePath of operationsByFile.keys()) {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    await document.save();
  }
}

function applyFileOperations(
  filePath: string,
  originalText: string,
  fileState: TranslationFileState | undefined,
  operations: TranslationSyncOperation[],
): string {
  const textOperations: Array<{
    type: 'insert' | 'delete';
    start: number;
    end: number;
    text: string;
  }> = [];

  if (!fileState) {
    const additions = operations.filter((operation) => operation.type === 'add-missing');
    const insertedText = additions.map((operation) => buildYamlBlock(operation.key.split('.'), 0)).join('');

    return insertedText;
  }

  for (const operation of operations) {
    if (operation.type === 'add-missing') {
      const insertion = buildInsertionOperation(fileState, operation.key);

      if (insertion) {
        textOperations.push({
          type: 'insert',
          start: insertion.offset,
          end: insertion.offset,
          text: insertion.text,
        });
      }
    }

    if (operation.type === 'delete-unused') {
      const deletion = buildDeletionOperation(fileState, operation.key);

      if (deletion) {
        textOperations.push({
          type: 'delete',
          start: deletion.start,
          end: deletion.end,
          text: '',
        });
      }
    }
  }

  textOperations.sort((left, right) => {
    if (left.start !== right.start) {
      return right.start - left.start;
    }

    return left.type === 'delete' ? -1 : 1;
  });

  let nextText = originalText;

  for (const operation of textOperations) {
    nextText = `${nextText.slice(0, operation.start)}${operation.text}${nextText.slice(operation.end)}`;
  }

  return normalizeTrailingNewline(nextText);
}

function buildInsertionOperation(
  fileState: TranslationFileState,
  key: string,
): {
  offset: number;
  text: string;
} | undefined {
  const segments = key.split('.');

  if (fileState.pairStates.has(key)) {
    return undefined;
  }

  for (let depth = segments.length - 1; depth >= 1; depth -= 1) {
    const parentKey = segments.slice(0, depth).join('.');
    const parentState = fileState.pairStates.get(parentKey);

    if (!parentState || !parentState.isBranch) {
      continue;
    }

    const insertionOffset = findInsertionOffset(fileState, parentState.childKeys, parentState.blockEndOffset, segments[depth]);
    const prefix = insertionOffset > 0 && !fileState.text.slice(0, insertionOffset).endsWith('\n') ? '\n' : '';

    return {
      offset: insertionOffset,
      text: `${prefix}${buildYamlBlock(segments.slice(depth), depth)}`,
    };
  }

  const rootChildKeys = Array.from(fileState.pairStates.values())
    .filter((state) => state.pathSegments.length === 1)
    .map((state) => state.key);
  const insertionOffset = findInsertionOffset(fileState, rootChildKeys, fileState.text.length, segments[0]);
  const prefix = insertionOffset > 0 && !fileState.text.slice(0, insertionOffset).endsWith('\n') ? '\n' : '';

  return {
    offset: insertionOffset,
    text: `${prefix}${buildYamlBlock(segments, 0)}`,
  };
}

function buildDeletionOperation(
  fileState: TranslationFileState,
  key: string,
): {
  start: number;
  end: number;
} | undefined {
  let currentKey = key;
  let currentState = fileState.pairStates.get(currentKey);

  if (!currentState) {
    return undefined;
  }

  while (true) {
    const parentKey = currentState.pathSegments.slice(0, -1).join('.');

    if (parentKey.length === 0) {
      break;
    }

    const parentState = fileState.pairStates.get(parentKey);

    if (!parentState || parentState.childKeys.length !== 1) {
      break;
    }

    currentKey = parentKey;
    currentState = parentState;
  }

  const start = currentState.blockStartOffset;
  const end = currentState.blockEndOffset;

  return {
    start,
    end,
  };
}

function buildYamlBlock(segments: string[], baseDepth: number): string {
  return `${segments
    .map((segment, index) => {
      const indent = '    '.repeat(baseDepth + index);

      if (index === segments.length - 1) {
        return `${indent}${segment}: "" # ${TRANSLATION_TODO_MARKER}`;
      }

      return `${indent}${segment}:`;
    })
    .join('\n')}\n`;
}

function findInsertionOffset(
  fileState: TranslationFileState,
  siblingKeys: string[],
  fallbackOffset: number,
  newSegment: string,
): number {
  const siblingStates = siblingKeys
    .map((childKey) => fileState.pairStates.get(childKey))
    .filter((state): state is NonNullable<typeof state> => Boolean(state))
    .sort((left, right) => left.blockStartOffset - right.blockStartOffset);

  for (const siblingState of siblingStates) {
    const siblingSegment = siblingState.pathSegments[siblingState.pathSegments.length - 1] ?? '';

    if (compareTranslationSiblingKeys(newSegment, siblingSegment) < 0) {
      return siblingState.blockStartOffset;
    }
  }

  return fallbackOffset;
}

function compareTranslationSiblingKeys(left: string, right: string): number {
  const leftStartsWithUnderscore = left.startsWith('_');
  const rightStartsWithUnderscore = right.startsWith('_');

  if (leftStartsWithUnderscore && !rightStartsWithUnderscore) {
    return 1;
  }

  if (!leftStartsWithUnderscore && rightStartsWithUnderscore) {
    return -1;
  }

  return left.localeCompare(right);
}

function buildSyncPreview(operations: TranslationSyncOperation[]): string {
  if (operations.length === 0) {
    return '# Translation Sync Preview\n\nNo translation changes are required.\n';
  }

  return [
    '# Translation Sync Preview',
    '',
    ...operations.map((operation) => `- [${operation.type}] ${operation.description}`),
    '',
  ].join('\n');
}

function normalizeTrailingNewline(value: string): string {
  if (value.length === 0) {
    return '';
  }

  return value.endsWith('\n') ? value : `${value}\n`;
}
