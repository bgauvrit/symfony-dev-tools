import * as assert from 'node:assert/strict';
import * as path from 'node:path';

import { filterEntityDiagramModel, getDiagramDomains } from '../../features/entities/diagramFilters';
import { scanEntityRoots } from '../../features/entities/doctrineScanner';
import { buildGraphvizDiagram, renderGraphvizDiagram } from '../../features/entities/graphvizDiagram';
import type { FilteredEntityDiagramModel } from '../../features/entities/model';

describe('Graphviz Doctrine diagram', () => {
  const fixtureRoot = path.resolve(__dirname, '../../../test-fixtures/entities');

  it('builds domain clusters and relation labels without duplicate edges', async () => {
    const model = await scanEntityRoots([fixtureRoot]);
    const filteredModel = filterEntityDiagramModel(model, {
      includedDomains: getDiagramDomains(model),
      query: '',
    });
    const graph = buildGraphvizDiagram(filteredModel, model.aliases);
    const catalogCluster = graph.subgraphs?.find((subgraph) => subgraph.name === 'cluster_Catalog');
    const manyToManyEdges =
      graph.edges?.filter(
        (edge) =>
          edge.tail === model.aliases['App\\Entity\\Orders\\OrderItem'] &&
          edge.head === model.aliases['App\\Entity\\Options\\OptionChoice'],
      ) ?? [];

    assert.ok(catalogCluster);
    assert.equal(manyToManyEdges.length, 1);
    assert.equal(manyToManyEdges[0]?.attributes?.taillabel, '0..*');
    assert.equal(manyToManyEdges[0]?.attributes?.headlabel, '0..*');
  });

  it('limits node fields to six rows and adds a more marker', () => {
    const filteredModel: FilteredEntityDiagramModel = {
      entities: [
        {
          name: 'User',
          namespace: 'App\\Entity\\Accounts',
          domain: 'Accounts',
          filePath: 'C:\\workspace\\src\\Entity\\Accounts\\User.php',
          fields: [
            { name: 'id', type: 'int', nullable: true },
            { name: 'email', type: 'string', nullable: true },
            { name: 'firstName', type: 'string', nullable: true },
            { name: 'lastName', type: 'string', nullable: true },
            { name: 'roles', type: 'array', nullable: false },
            { name: 'locale', type: 'string', nullable: true },
            { name: 'createdAt', type: 'DateTimeInterface', nullable: true },
            { name: 'updatedAt', type: 'DateTimeInterface', nullable: true },
          ],
        },
      ],
      relations: [],
      warnings: [],
      domains: ['Accounts'],
      filterState: {
        query: '',
        includedDomains: ['Accounts'],
      },
      visibleEntityIds: ['App\\Entity\\Accounts\\User'],
      summary: {
        totalEntities: 1,
        totalRelations: 0,
        visibleEntities: 1,
        visibleRelations: 0,
      },
    };
    const graph = buildGraphvizDiagram(filteredModel, {
      'App\\Entity\\Accounts\\User': 'App_Entity_Accounts_User',
    });
    const userNode = graph.subgraphs?.[0]?.nodes?.[0];
    const htmlLabel = typeof userNode?.attributes?.label === 'object' ? userNode.attributes.label.html : '';

    assert.equal(htmlLabel.includes('+createdAt'), false);
    assert.equal(htmlLabel.includes('... +2 more'), true);
  });

  it('renders an SVG with clickable entity urls', async () => {
    const model = await scanEntityRoots([fixtureRoot]);
    const filteredModel = filterEntityDiagramModel(model, {
      includedDomains: getDiagramDomains(model),
      query: 'product',
    });
    const renderedDiagram = await renderGraphvizDiagram(filteredModel, model.aliases);

    assert.equal(renderedDiagram.svg.includes('cluster_Catalog'), true);
    assert.equal(renderedDiagram.svg.includes('entity://App%5CEntity%5CCatalog%5CProduct'), true);
  });
});
