import * as vscode from 'vscode';

import type { SymfonyDoctrineToolsApi } from './api';
import { COMMANDS, EXTENSION_NAMESPACE, VIEW_IDS } from './constants';
import { createSymfonyProject } from './features/bootstrap/projectBootstrap';
import { EntityDiagramPanelController } from './features/entities/entityDiagramPanel';
import { DiagramShortcutViewProvider } from './features/entities/diagramShortcutView';
import { ActionsViewProvider } from './features/tasks/actionsView';
import { setLastUsedTaskForGroup } from './features/tasks/taskHistory';
import { getTaskCommandLine, getTaskGroup } from './features/tasks/taskGrouping';
import { executeWorkspaceTask, listWorkspaceTasks, type RunTaskArgs } from './features/tasks/taskRunner';
import { insertContextTemplate } from './features/templates/templateInserter';
import { TranslationAuditController } from './features/translations/auditController';
import { TranslationCodeActionProvider } from './features/translations/codeActions';
import { TranslationDefinitionProvider } from './features/translations/translationDefinition';
import { TranslationCodeLensProvider } from './features/translations/translationCodeLens';
import { SymfonyWebController } from './features/web/controller';
import { SymfonyWebDefinitionProvider } from './features/web/definitionProvider';
import { SymfonyWebReferenceProvider } from './features/web/referenceProvider';
import { SymfonyTwigCodeLensProvider } from './features/web/twigCodeLens';
import { SymfonyTwigRouteCompletionProvider } from './features/web/twigCompletion';

export async function activate(context: vscode.ExtensionContext): Promise<SymfonyDoctrineToolsApi> {
  const actionsViewProvider = new ActionsViewProvider(context.workspaceState);
  const diagramShortcutViewProvider = new DiagramShortcutViewProvider();
  let translationCodeLensProvider: TranslationCodeLensProvider;
  const entityDiagramController = new EntityDiagramPanelController(context, () => {
    actionsViewProvider.refresh();
  });
  const translationAuditController = new TranslationAuditController(context, () => {
    actionsViewProvider.refresh();
    translationCodeLensProvider.refresh();
  });
  const translationDefinitionProvider = new TranslationDefinitionProvider(translationAuditController);
  translationCodeLensProvider = new TranslationCodeLensProvider(translationAuditController);
  const symfonyWebController = new SymfonyWebController(context);
  const symfonyTwigCodeLensProvider = new SymfonyTwigCodeLensProvider(symfonyWebController);
  const symfonyWebDefinitionProvider = new SymfonyWebDefinitionProvider(symfonyWebController);
  const symfonyWebReferenceProvider = new SymfonyWebReferenceProvider(symfonyWebController);
  const symfonyTwigRouteCompletionProvider = new SymfonyTwigRouteCompletionProvider(symfonyWebController);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(VIEW_IDS.actions, actionsViewProvider),
    vscode.window.registerTreeDataProvider(VIEW_IDS.diagram, diagramShortcutViewProvider),
    vscode.window.registerTreeDataProvider(VIEW_IDS.translations, translationAuditController.getReportViewProvider()),
    vscode.languages.registerCodeActionsProvider(
      [
        { language: 'php', scheme: 'file' },
        { language: 'twig', scheme: 'file' },
        { language: 'yaml', scheme: 'file' },
      ],
      new TranslationCodeActionProvider(translationAuditController),
      {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
      },
    ),
    vscode.languages.registerCodeLensProvider(
      [
        { language: 'yaml', scheme: 'file' },
      ],
      translationCodeLensProvider,
    ),
    vscode.languages.registerCodeLensProvider(
      [
        { language: 'twig', scheme: 'file' },
      ],
      symfonyTwigCodeLensProvider,
    ),
    vscode.languages.registerDefinitionProvider(
      [
        { language: 'php', scheme: 'file' },
        { language: 'twig', scheme: 'file' },
      ],
      translationDefinitionProvider,
    ),
    vscode.languages.registerDefinitionProvider(
      [
        { language: 'php', scheme: 'file' },
        { language: 'twig', scheme: 'file' },
      ],
      symfonyWebDefinitionProvider,
    ),
    vscode.languages.registerReferenceProvider(
      [
        { language: 'php', scheme: 'file' },
        { language: 'twig', scheme: 'file' },
      ],
      symfonyWebReferenceProvider,
    ),
    vscode.languages.registerCompletionItemProvider(
      [
        { language: 'twig', scheme: 'file' },
      ],
      symfonyTwigRouteCompletionProvider,
      '\'',
      '"',
      '{',
      ',',
    ),
    entityDiagramController,
    translationAuditController,
    symfonyWebController,
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.runTask, async (args?: RunTaskArgs) => {
      try {
        const resolvedArgs = args ?? (await promptForTaskSelection());

        if (!resolvedArgs) {
          return;
        }

        await executeWorkspaceTask(resolvedArgs);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Impossible d executer la tache workspace.';
        void vscode.window.showErrorMessage(message);
        throw error;
      } finally {
        actionsViewProvider.refresh();
      }
    }),
    vscode.commands.registerCommand(COMMANDS.openEntityDiagram, async () => {
      await entityDiagramController.open();
    }),
    vscode.commands.registerCommand(COMMANDS.refreshEntityDiagram, async () => {
      await entityDiagramController.refresh();
    }),
    vscode.commands.registerCommand(
      COMMANDS.openEntityFile,
      async (args: { entityId?: string; filePath?: string; line?: number }) => {
        await entityDiagramController.openEntityFile(args ?? {});
      },
    ),
    vscode.commands.registerCommand(COMMANDS.scanTranslations, async () => {
      await translationAuditController.refresh(true);
    }),
    vscode.commands.registerCommand(COMMANDS.openTranslationsReport, async () => {
      await translationAuditController.openReport();
    }),
    vscode.commands.registerCommand(COMMANDS.syncTranslations, async (issueIds?: string[]) => {
      await translationAuditController.syncTranslations(issueIds);
    }),
    vscode.commands.registerCommand(COMMANDS.insertTemplate, async () => {
      await insertContextTemplate();
    }),
    vscode.commands.registerCommand(COMMANDS.createSymfonyProject, async () => {
      await createSymfonyProject();
    }),
    vscode.commands.registerCommand(COMMANDS.applyTranslationFix, async (issueId: string) => {
      await translationAuditController.applyFix(issueId);
    }),
    vscode.commands.registerCommand(COMMANDS.applyTranslationAnnotationFix, async (issueId: string) => {
      await translationAuditController.applyAnnotationFix(issueId);
    }),
    vscode.commands.registerCommand(COMMANDS.openTranslationIssue, async (issueId: string) => {
      await translationAuditController.openIssue(issueId);
    }),
    vscode.commands.registerCommand(
      COMMANDS.openTranslationPeer,
      async (args: { filePath: string; key: string; targetLocale: string }) => {
        await translationAuditController.openPeerTranslation(args);
      },
    ),
    vscode.commands.registerCommand(
      COMMANDS.openWebTargets,
      async (targets: Parameters<SymfonyWebController['openTargets']>[0], quickPickTitle: string) => {
        await symfonyWebController.openTargets(targets, quickPickTitle);
      },
    ),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(EXTENSION_NAMESPACE)) {
        actionsViewProvider.refresh();
        void translationAuditController.refresh();
        void symfonyWebController.refresh();
        symfonyTwigCodeLensProvider.refresh();

        if (entityDiagramController.isOpen()) {
          void entityDiagramController.refresh();
        }
      }
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      entityDiagramController.scheduleRefreshForDocument(event.document);
      translationAuditController.scheduleRefreshForDocument(event.document);
      symfonyWebController.scheduleRefreshForDocument(event.document);
      symfonyTwigCodeLensProvider.refresh();
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (document.fileName.endsWith('tasks.json') || document.fileName.endsWith('.code-workspace')) {
        actionsViewProvider.refresh();
      }

      entityDiagramController.scheduleRefreshForDocument(document);
      translationAuditController.scheduleRefreshForDocument(document);
      symfonyWebController.scheduleRefreshForDocument(document);
      symfonyTwigCodeLensProvider.refresh();
    }),
    vscode.tasks.onDidStartTask((event) => {
      if (event.execution.task.scope === vscode.TaskScope.Global) {
        return;
      }

      const group = getTaskGroup(getTaskCommandLine(event.execution.task));

      if (!group) {
        return;
      }

      void setLastUsedTaskForGroup(context.workspaceState, group.key, {
        taskLabel: event.execution.task.name,
        taskSource: event.execution.task.source,
      }).finally(() => {
        actionsViewProvider.refresh();
      });
    }),
  );

  if (vscode.workspace.workspaceFolders?.length) {
    void translationAuditController.refresh();
    void symfonyWebController.refresh();
  }

  return {
    getActionsSnapshot: () => actionsViewProvider.getActionsSnapshot(),
    getDiagramState: () => ({
      isOpen: entityDiagramController.isOpen(),
      model: entityDiagramController.getLatestModel(),
      filterState: entityDiagramController.getLatestFilterState(),
      domains: entityDiagramController.getLatestDomains(),
      visibleEntityIds: entityDiagramController.getLatestVisibleEntityIds(),
      warnings: entityDiagramController.getLatestWarnings(),
      summary: entityDiagramController.getLatestSummary(),
      hasSvg: entityDiagramController.hasSuccessfulSvg(),
    }),
    updateDiagramFilters: async (nextState) => {
      await entityDiagramController.updateFilters(nextState);
    },
    getTranslationState: () => translationAuditController.getStateSnapshot(),
    scanTranslations: async () => {
      await translationAuditController.refresh();
    },
  };
}

export function deactivate(): void {}

async function promptForTaskSelection(): Promise<RunTaskArgs | undefined> {
  const tasks = await listWorkspaceTasks();

  if (tasks.length === 0) {
    void vscode.window.showWarningMessage('Aucune tache workspace disponible.');
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(
    tasks.map((task) => ({
      label: task.name,
      description: task.source,
      task,
    })),
    {
      title: 'Run Workspace Task',
      placeHolder: 'Choisis une tache workspace existante',
    },
  );

  if (!picked) {
    return undefined;
  }

  return {
    taskLabel: picked.task.name,
    taskSource: picked.task.source,
  };
}
