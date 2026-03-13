import * as assert from 'node:assert/strict';
import * as path from 'node:path';

import { scanEntityRoots } from '../../features/entities/doctrineScanner';

describe('Doctrine scanner', () => {
  const fixtureRoot = path.resolve(__dirname, '../../../test-fixtures/entities');

  it('detects entities across Biothanimo-like domains', async () => {
    const model = await scanEntityRoots([fixtureRoot]);
    const entityIds = new Set(model.entities.map((entity) => `${entity.namespace}\\${entity.name}`));
    const domains = new Set(model.entities.map((entity) => entity.domain));

    assert.ok(entityIds.has('App\\Entity\\Accounts\\User'));
    assert.ok(entityIds.has('App\\Entity\\Catalog\\Product'));
    assert.ok(entityIds.has('App\\Entity\\Materials\\VariantBiothaneSize'));
    assert.ok(entityIds.has('App\\Entity\\Options\\OptionChoice'));
    assert.ok(entityIds.has('App\\Entity\\Orders\\CustomerOrder'));

    assert.deepEqual(
      Array.from(domains).sort((left, right) => left.localeCompare(right)),
      ['Accounts', 'Catalog', 'Materials', 'Options', 'Orders'],
    );
  });

  it('computes relation multiplicities and deduplicates inverse relations', async () => {
    const model = await scanEntityRoots([fixtureRoot]);
    const productRelation = model.relations.find(
      (relation) =>
        relation.source === 'App\\Entity\\Catalog\\ProductVariant' &&
        relation.target === 'App\\Entity\\Catalog\\Product' &&
        relation.label === 'product',
    );
    const packagingRelation = model.relations.find(
      (relation) =>
        relation.source === 'App\\Entity\\Orders\\CustomerOrder' &&
        relation.target === 'App\\Entity\\Orders\\Packaging' &&
        relation.label === 'packaging',
    );
    const manyToManyRelations = model.relations.filter(
      (relation) =>
        relation.source === 'App\\Entity\\Orders\\OrderItem' &&
        relation.target === 'App\\Entity\\Options\\OptionChoice',
    );

    assert.equal(productRelation?.targetMultiplicity, '1');
    assert.equal(packagingRelation?.targetMultiplicity, '0..1');
    assert.equal(manyToManyRelations.length, 1);
    assert.equal(model.classToFilePath['App\\Entity\\Orders\\OrderItem'].endsWith(path.join('Orders', 'OrderItem.php')), true);
  });

  it('includes mapped superclasses only when configured', async () => {
    const withoutMappedSuperclass = await scanEntityRoots([fixtureRoot]);
    const withMappedSuperclass = await scanEntityRoots([fixtureRoot], {
      includeMappedSuperclass: true,
    });

    assert.equal(
      withoutMappedSuperclass.entities.some((entity) => entity.name === 'Timestampable'),
      false,
    );
    assert.equal(
      withMappedSuperclass.entities.some((entity) => entity.name === 'Timestampable'),
      true,
    );
  });

  it('reports invalid php files as warnings', async () => {
    const model = await scanEntityRoots([fixtureRoot]);

    assert.equal(
      model.warnings.some((warning) => warning.includes('BrokenEntity.php')),
      true,
    );
  });

  it('uses in-memory text overrides for real-time refreshes', async () => {
    const productPath = path.join(fixtureRoot, 'Catalog', 'Product.php');
    const model = await scanEntityRoots([fixtureRoot], {
      textOverrides: new Map([
        [
          productPath,
          `<?php

namespace App\\Entity\\Catalog;

use Doctrine\\ORM\\Mapping as ORM;

#[ORM\\Entity]
class Product
{
    #[ORM\\Id]
    #[ORM\\Column]
    private ?int $id = null;

    #[ORM\\Column(length: 255)]
    private ?string $name = null;

    #[ORM\\Column(length: 30)]
    private ?string $liveLabel = null;
}`,
        ],
      ]),
    });

    const product = model.entities.find((entity) => entity.name === 'Product');

    assert.equal(product?.fields.some((field) => field.name === 'liveLabel'), true);
  });
});
