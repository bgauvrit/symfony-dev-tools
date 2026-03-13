import { instance, type Graph, type HTMLString, type RenderError, type Viz } from '@viz-js/viz';

import { getEntityId, type EntityDiagramModel, type EntityField, type FilteredEntityDiagramModel } from './model';

const FONT_FAMILY = 'Helvetica';
const MAX_VISIBLE_FIELDS = 6;

let vizInstancePromise: Promise<Viz> | undefined;

export interface GraphvizRenderResult {
  svg: string;
  warnings: string[];
}

export function buildGraphvizDiagram(
  filteredModel: FilteredEntityDiagramModel,
  aliases: EntityDiagramModel['aliases'],
): Graph {
  const nodesByDomain = new Map<string, Graph['nodes']>();

  for (const entity of filteredModel.entities) {
    const entityId = getEntityId(entity);
    const alias = aliases[entityId] ?? fallbackAlias(entityId);
    const domainNodes = nodesByDomain.get(entity.domain) ?? [];

    domainNodes.push({
      name: alias,
      attributes: {
        id: `entity-${alias}`,
        class: 'entity-node',
        shape: 'plain',
        margin: 0,
        tooltip: entityId,
        URL: buildEntityUrl(entityId),
        label: buildEntityLabel(entity.name, entity.fields),
      },
    });
    nodesByDomain.set(entity.domain, domainNodes);
  }

  return {
    directed: true,
    strict: true,
    graphAttributes: {
      rankdir: 'LR',
      bgcolor: 'transparent',
      compound: true,
      newrank: true,
      pad: 0.45,
      nodesep: 0.72,
      ranksep: 1.1,
      overlap: 'false',
      splines: 'spline',
      outputorder: 'edgesfirst',
      fontname: FONT_FAMILY,
      fontsize: 12,
    },
    nodeAttributes: {
      fontname: FONT_FAMILY,
    },
    edgeAttributes: {
      color: '#3d564d',
      fontcolor: '#2f4c45',
      fontsize: 11,
      penwidth: 1.35,
      arrowsize: 0.65,
      labelfontsize: 10,
      labeldistance: 1.1,
      labelangle: 18,
      tooltip: '',
    },
    subgraphs: filteredModel.domains
      .map((domain) => {
        const nodes = nodesByDomain.get(domain) ?? [];

        if (nodes.length === 0) {
          return undefined;
        }

        return {
          name: `cluster_${sanitizeClusterName(domain)}`,
          graphAttributes: {
            label: domain,
            color: '#cad8d3',
            bgcolor: '#f7fbf9',
            style: 'rounded,filled',
            penwidth: 1.1,
            margin: 18,
            labelloc: 't',
            labeljust: 'l',
            fontname: FONT_FAMILY,
            fontcolor: '#33534b',
            fontsize: 12,
          },
          nodes,
        };
      })
      .filter((subgraph): subgraph is NonNullable<typeof subgraph> => Boolean(subgraph)),
    edges: filteredModel.relations
      .map((relation) => {
        const sourceAlias = aliases[relation.source] ?? fallbackAlias(relation.source);
        const targetAlias = aliases[relation.target] ?? fallbackAlias(relation.target);

        return {
          tail: sourceAlias,
          head: targetAlias,
          attributes: {
            id: `relation-${sourceAlias}-${targetAlias}-${sanitizeClusterName(relation.label)}`,
            class: 'entity-relation',
            label: relation.label,
            taillabel: relation.sourceMultiplicity,
            headlabel: relation.targetMultiplicity,
            arrowhead: relation.kind === 'ManyToMany' ? 'none' : 'normal',
            minlen: 1,
            tooltip: `${relation.source} -> ${relation.target} (${relation.label})`,
          },
        };
      })
      .sort((left, right) => {
        const leftKey = `${left.tail}:${String(left.attributes?.label)}:${left.head}`;
        const rightKey = `${right.tail}:${String(right.attributes?.label)}:${right.head}`;

        return leftKey.localeCompare(rightKey);
      }),
  };
}

export async function renderGraphvizDiagram(
  filteredModel: FilteredEntityDiagramModel,
  aliases: EntityDiagramModel['aliases'],
): Promise<GraphvizRenderResult> {
  const viz = await getVizInstance();
  const renderResult = viz.render(buildGraphvizDiagram(filteredModel, aliases), {
    format: 'svg',
    engine: 'dot',
  });

  if (renderResult.status === 'failure') {
    throw new Error(formatRenderErrors(renderResult.errors));
  }

  return {
    svg: renderResult.output,
    warnings: renderResult.errors.map((error) => formatRenderError(error)),
  };
}

function buildEntityUrl(entityId: string): string {
  return `entity://${encodeURIComponent(entityId)}`;
}

function buildEntityLabel(name: string, fields: EntityField[]): HTMLString {
  const visibleFields = fields.slice(0, MAX_VISIBLE_FIELDS);
  const hiddenCount = Math.max(fields.length - visibleFields.length, 0);
  const rows = [
    `<TR><TD BGCOLOR="#e6d8b0" COLOR="#cbb88a" ALIGN="CENTER"><FONT FACE="${FONT_FAMILY}" POINT-SIZE="15"><B>${escapeHtml(
      name,
    )}</B></FONT></TD></TR>`,
    ...visibleFields.map(
      (field) =>
        `<TR><TD ALIGN="LEFT"><FONT FACE="${FONT_FAMILY}" POINT-SIZE="11">+${escapeHtml(field.name)}: ${escapeHtml(
          field.type,
        )}${field.nullable ? '?' : ''}</FONT></TD></TR>`,
    ),
  ];

  if (hiddenCount > 0) {
    rows.push(
      `<TR><TD ALIGN="LEFT"><FONT FACE="${FONT_FAMILY}" POINT-SIZE="11" COLOR="#6c7b76">... +${hiddenCount} more</FONT></TD></TR>`,
    );
  }

  return {
    html: `<TABLE BORDER="0" CELLBORDER="1" CELLSPACING="0" CELLPADDING="9" COLOR="#d6c7a6" BGCOLOR="#fbf7ea">${rows.join(
      '',
    )}</TABLE>`,
  };
}

async function getVizInstance(): Promise<Viz> {
  vizInstancePromise ??= instance();

  return vizInstancePromise;
}

function formatRenderErrors(errors: RenderError[]): string {
  if (errors.length === 0) {
    return 'Graphviz could not render the Doctrine diagram.';
  }

  return errors.map((error) => formatRenderError(error)).join(' | ');
}

function formatRenderError(error: RenderError): string {
  if (error.level) {
    return `[${error.level}] ${error.message}`;
  }

  return error.message;
}

function sanitizeClusterName(value: string): string {
  return value.replace(/[^A-Za-z0-9_]+/g, '_');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fallbackAlias(entityId: string): string {
  return entityId.replace(/[^A-Za-z0-9_]/g, '_');
}
