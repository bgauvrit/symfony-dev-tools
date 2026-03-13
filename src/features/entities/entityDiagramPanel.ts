import * as path from 'node:path';

import * as vscode from 'vscode';

import { PANEL_IDS } from '../../constants';
import { buildEntityDiagramHtml } from '../../webview/entityDiagramHtml';
import {
  createDefaultDiagramFilterState,
  filterEntityDiagramModel,
  mergeDiagramFilterState,
} from './diagramFilters';
import { isEntityFile, scanEntityRoots } from './doctrineScanner';
import { renderGraphvizDiagram } from './graphvizDiagram';
import type {
  DiagramFilterState,
  DiagramSummary,
  EntityDiagramModel,
  EntityDiagramRenderPayload,
} from './model';
import { getEntitySettings, resolveEntityRoots } from './settings';

interface OpenEntityFileArgs {
  entityId?: string;
  filePath?: string;
  line?: number;
}

type DiagramViewMessage =
  | {
      type: 'openEntityFile';
      payload: OpenEntityFileArgs;
    }
  | {
      type: 'updateFilters';
      payload: DiagramFilterState;
    };

export class EntityDiagramPanelController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private latestModel: EntityDiagramModel | undefined;
  private latestRenderPayload: EntityDiagramRenderPayload;
  private latestFilterState = createDefaultDiagramFilterState();
  private lastSuccessfulSvg: string | undefined;
  private refreshTimer: NodeJS.Timeout | undefined;

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly onDiagramStateChanged: () => void,
  ) {
    this.latestRenderPayload = createEmptyRenderPayload();
  }

  public isOpen(): boolean {
    return Boolean(this.panel);
  }

  public getLatestModel(): EntityDiagramModel | undefined {
    return this.latestModel;
  }

  public getLatestFilterState(): DiagramFilterState {
    return this.latestRenderPayload.filterState;
  }

  public getLatestDomains(): string[] {
    return this.latestRenderPayload.domains;
  }

  public getLatestVisibleEntityIds(): string[] {
    return this.latestRenderPayload.visibleEntityIds;
  }

  public getLatestWarnings(): string[] {
    return this.latestRenderPayload.warnings;
  }

  public getLatestSummary(): DiagramSummary | undefined {
    return this.latestModel ? this.latestRenderPayload.summary : undefined;
  }

  public hasSuccessfulSvg(): boolean {
    return Boolean(this.latestRenderPayload.svg);
  }

  public async open(): Promise<void> {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active, false);
      await this.refresh();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      PANEL_IDS.entityDiagram,
      'Doctrine Entity Diagram',
      {
        viewColumn: vscode.ViewColumn.Active,
        preserveFocus: false,
      },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.context.extensionUri],
      },
    );
    this.panel.webview.html = buildEntityDiagramHtml(this.panel.webview, this.context.extensionUri, this.latestRenderPayload);
    this.panel.webview.onDidReceiveMessage((message: DiagramViewMessage) => {
      void this.handleWebviewMessage(message);
    });
    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.onDiagramStateChanged();
    });
    this.panel.onDidChangeViewState((event) => {
      if (event.webviewPanel.visible) {
        void this.refresh();
      }
    });

    this.onDiagramStateChanged();
    await this.refresh();
  }

  public async refresh(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (!workspaceFolder) {
      this.latestModel = createEmptyDiagramModel(['Aucun workspace actif pour le diagramme Doctrine.']);
      this.lastSuccessfulSvg = undefined;
      await this.renderCurrentModel();
      return;
    }

    const roots = resolveEntityRoots(workspaceFolder);
    const settings = getEntitySettings(workspaceFolder);

    this.latestModel = await scanEntityRoots(roots, {
      includeMappedSuperclass: settings.includeMappedSuperclass,
      textOverrides: this.collectTextOverrides(roots),
    });

    await this.renderCurrentModel();
  }

  public async updateFilters(nextState: Partial<DiagramFilterState>): Promise<void> {
    this.latestFilterState = mergeDiagramFilterState(this.latestFilterState, nextState);

    if (!this.latestModel) {
      if (this.panel) {
        await this.refresh();
      }

      return;
    }

    await this.renderCurrentModel();
  }

  public scheduleRefreshForDocument(document: vscode.TextDocument): void {
    if (!this.panel || document.uri.scheme !== 'file') {
      return;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);

    if (!workspaceFolder) {
      return;
    }

    const settings = getEntitySettings(workspaceFolder);

    if (!settings.autoRefreshDiagram) {
      return;
    }

    const roots = resolveEntityRoots(workspaceFolder);

    if (!isEntityFile(document.uri.fsPath, roots)) {
      return;
    }

    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    this.refreshTimer = setTimeout(() => {
      void this.refresh();
    }, 180);
  }

  public async openEntityFile(args: OpenEntityFileArgs): Promise<void> {
    const filePath = args.filePath ?? (args.entityId ? this.latestModel?.classToFilePath[args.entityId] : undefined);

    if (!filePath) {
      void vscode.window.showErrorMessage('Impossible de retrouver le fichier PHP associe a cette entite.');
      return;
    }

    const document = await vscode.workspace.openTextDocument(filePath);
    const classLine = args.entityId ? this.latestModel?.classToLine[args.entityId] : undefined;
    let selection = new vscode.Selection(0, 0, 0, 0);

    if (typeof args.line === 'number' && args.line > 0) {
      const position = new vscode.Position(Math.max(0, args.line - 1), 0);
      selection = new vscode.Selection(position, position);
    } else if (typeof classLine === 'number' && classLine > 0) {
      const position = new vscode.Position(Math.max(0, classLine - 1), 0);
      selection = new vscode.Selection(position, position);
    } else if (args.entityId) {
      const className = args.entityId.split('\\').pop();

      if (className) {
        const index = document.getText().search(new RegExp(`\\bclass\\s+${escapeRegExp(className)}\\b`));

        if (index >= 0) {
          const position = document.positionAt(index);
          selection = new vscode.Selection(position, position);
        }
      }
    }

    await vscode.window.showTextDocument(document, {
      preview: false,
      selection,
    });
  }

  public dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    this.panel?.dispose();
    this.panel = undefined;
  }

  private collectTextOverrides(roots: string[]): Map<string, string> {
    const textOverrides = new Map<string, string>();

    for (const document of vscode.workspace.textDocuments) {
      if (document.uri.scheme !== 'file') {
        continue;
      }

      if (!isEntityFile(document.uri.fsPath, roots)) {
        continue;
      }

      textOverrides.set(path.normalize(document.uri.fsPath), document.getText());
    }

    return textOverrides;
  }

  private async renderCurrentModel(): Promise<void> {
    const model = this.latestModel ?? createEmptyDiagramModel();
    const filteredModel = filterEntityDiagramModel(model, this.latestFilterState);
    const warnings = [...filteredModel.warnings];
    let svg: string | undefined;

    this.latestFilterState = filteredModel.filterState;

    if (filteredModel.entities.length > 0) {
      try {
        const renderResult = await renderGraphvizDiagram(filteredModel, model.aliases);

        svg = renderResult.svg;
        this.lastSuccessfulSvg = renderResult.svg;
        warnings.push(...renderResult.warnings);
      } catch (error) {
        svg = this.lastSuccessfulSvg;
        warnings.push(formatErrorMessage(error));
      }
    }

    this.latestRenderPayload = {
      ...filteredModel,
      warnings,
      svg,
    };

    if (this.panel) {
      await this.panel.webview.postMessage({
        type: 'renderGraph',
        payload: this.latestRenderPayload,
      });
    }

    this.onDiagramStateChanged();
  }

  private async handleWebviewMessage(message: DiagramViewMessage): Promise<void> {
    if (message.type === 'openEntityFile') {
      await this.openEntityFile(message.payload);
      return;
    }

    if (message.type === 'updateFilters') {
      await this.updateFilters(message.payload);
    }
  }
}

function createEmptyDiagramModel(warnings: string[] = []): EntityDiagramModel {
  return {
    entities: [],
    relations: [],
    warnings,
    generatedAt: new Date(0).toISOString(),
    classToFilePath: {},
    classToLine: {},
    aliases: {},
  };
}

function createEmptyRenderPayload(): EntityDiagramRenderPayload {
  return {
    entities: [],
    relations: [],
    warnings: [],
    domains: [],
    filterState: createDefaultDiagramFilterState(),
    visibleEntityIds: [],
    summary: {
      totalEntities: 0,
      totalRelations: 0,
      visibleEntities: 0,
      visibleRelations: 0,
    },
    svg: undefined,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `Graphviz render failed: ${error.message}`;
  }

  return 'Graphviz render failed.';
}
