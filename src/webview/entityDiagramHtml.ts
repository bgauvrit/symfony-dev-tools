import * as vscode from 'vscode';

import type { EntityDiagramRenderPayload } from '../features/entities/model';

export function buildEntityDiagramHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  initialState: EntityDiagramRenderPayload,
): string {
  const nonce = createNonce();
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'entityDiagramApp.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'entityDiagram.css'));

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Doctrine Entity Diagram</title>
    <link rel="stylesheet" href="${styleUri}" />
  </head>
  <body>
    <div class="layout">
      <header class="toolbar">
        <div class="toolbar__copy">
          <h1>Doctrine Entity Diagram</h1>
          <p id="summary">Scanning entities...</p>
        </div>
        <div class="toolbar__controls">
          <label class="search-field" for="diagram-search-input">
            <span>Search</span>
            <input id="diagram-search-input" type="search" placeholder="Product, Orders, App\\Entity..." />
          </label>
          <div class="zoom-controls" aria-label="Diagram zoom controls">
            <button id="clear-filters-button" type="button">Clear filters</button>
            <button id="zoom-out-button" type="button" aria-label="Zoom out">-</button>
            <button id="zoom-reset-button" type="button" aria-label="Reset zoom">100%</button>
            <button id="zoom-in-button" type="button" aria-label="Zoom in">+</button>
            <button id="zoom-fit-button" type="button" aria-label="Fit diagram">Fit</button>
          </div>
        </div>
      </header>
      <section class="filters">
        <div id="domain-filters" class="domain-filters" aria-label="Domain filters"></div>
      </section>
      <section id="warnings" class="warnings is-hidden"></section>
      <main id="graph" class="graph" aria-live="polite">
        <div class="graph-content">
          <div id="graph-scene" class="graph-scene"></div>
        </div>
      </main>
      <section id="empty-state" class="empty-state is-hidden"></section>
    </div>
    <script nonce="${nonce}">
      window.__ENTITY_DIAGRAM_INITIAL_STATE__ = ${JSON.stringify(initialState)};
    </script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
}

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';

  for (let index = 0; index < 32; index += 1) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }

  return nonce;
}
