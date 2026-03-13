import * as assert from 'node:assert/strict';
import * as path from 'node:path';

import {
  filterEntityDiagramModel,
  getDiagramDomains,
  normalizeDiagramFilterState,
} from '../../features/entities/diagramFilters';
import { scanEntityRoots } from '../../features/entities/doctrineScanner';

describe('Diagram filters', () => {
  const fixtureRoot = path.resolve(__dirname, '../../../test-fixtures/entities');

  it('keeps only the selected domains when no query is applied', async () => {
    const model = await scanEntityRoots([fixtureRoot]);
    const filteredModel = filterEntityDiagramModel(model, {
      includedDomains: ['Catalog'],
      query: '',
    });

    assert.deepEqual(filteredModel.entities.map((entity) => entity.domain), ['Catalog', 'Catalog']);
    assert.deepEqual(
      filteredModel.visibleEntityIds,
      ['App\\Entity\\Catalog\\Product', 'App\\Entity\\Catalog\\ProductVariant'],
    );
    assert.equal(filteredModel.summary.visibleRelations, 1);
  });

  it('expands query results to first-level neighbours for context', async () => {
    const model = await scanEntityRoots([fixtureRoot]);
    const filteredModel = filterEntityDiagramModel(model, {
      includedDomains: getDiagramDomains(model),
      query: 'option',
    });

    assert.equal(filteredModel.visibleEntityIds.includes('App\\Entity\\Options\\OptionChoice'), true);
    assert.equal(filteredModel.visibleEntityIds.includes('App\\Entity\\Options\\OptionGroup'), true);
    assert.equal(filteredModel.visibleEntityIds.includes('App\\Entity\\Orders\\OrderItem'), true);
  });

  it('normalizes unknown domains out of the filter state', () => {
    const normalizedState = normalizeDiagramFilterState(
      ['Accounts', 'Catalog', 'Orders'],
      {
        query: ' Product ',
        includedDomains: ['Catalog', 'Missing'],
      },
      {
        defaultToAllDomains: true,
      },
    );

    assert.deepEqual(normalizedState, {
      query: 'Product',
      includedDomains: ['Catalog'],
    });
  });
});
