import {
  getEntityId,
  type DiagramFilterState,
  type EntityDiagramModel,
  type EntityNode,
  type FilteredEntityDiagramModel,
} from './model';

export function createDefaultDiagramFilterState(): DiagramFilterState {
  return {
    query: '',
    includedDomains: [],
  };
}

export function mergeDiagramFilterState(
  baseState: DiagramFilterState,
  nextState: Partial<DiagramFilterState>,
): DiagramFilterState {
  return {
    query: nextState.query ?? baseState.query,
    includedDomains: nextState.includedDomains ?? baseState.includedDomains,
  };
}

export function getDiagramDomains(model: EntityDiagramModel): string[] {
  return Array.from(new Set(model.entities.map((entity) => entity.domain))).sort((left, right) =>
    left.localeCompare(right),
  );
}

export function normalizeDiagramFilterState(
  domains: string[],
  state: Partial<DiagramFilterState> | undefined,
  options: {
    defaultToAllDomains?: boolean;
  } = {},
): DiagramFilterState {
  const uniqueDomains = Array.from(new Set(domains)).sort((left, right) => left.localeCompare(right));
  const defaultToAllDomains = options.defaultToAllDomains ?? false;
  const rawIncludedDomains = Array.isArray(state?.includedDomains) ? state?.includedDomains : undefined;
  const normalizedQuery = typeof state?.query === 'string' ? state.query.trim() : '';

  if (!rawIncludedDomains) {
    return {
      query: normalizedQuery,
      includedDomains: defaultToAllDomains ? uniqueDomains : [],
    };
  }

  const allowedDomains = new Set(uniqueDomains);
  const normalizedDomains = Array.from(
    new Set(
      rawIncludedDomains
        .map((domain) => domain.trim())
        .filter((domain) => domain.length > 0 && allowedDomains.has(domain)),
    ),
  ).sort((left, right) => left.localeCompare(right));

  return {
    query: normalizedQuery,
    includedDomains: normalizedDomains,
  };
}

export function filterEntityDiagramModel(
  model: EntityDiagramModel,
  filterState: Partial<DiagramFilterState> | undefined,
): FilteredEntityDiagramModel {
  const domains = getDiagramDomains(model);
  const normalizedFilterState = normalizeDiagramFilterState(domains, filterState, {
    defaultToAllDomains: true,
  });
  const selectedDomains = new Set(normalizedFilterState.includedDomains);
  const domainFilteredEntities = model.entities.filter((entity) => selectedDomains.has(entity.domain));
  const domainFilteredIds = new Set(domainFilteredEntities.map((entity) => getEntityId(entity)));
  const visibleEntityIds = new Set<string>();
  const normalizedQuery = normalizedFilterState.query.toLocaleLowerCase();

  if (normalizedQuery.length === 0) {
    for (const entityId of domainFilteredIds) {
      visibleEntityIds.add(entityId);
    }
  } else {
    const matchedIds = new Set(
      domainFilteredEntities.filter((entity) => matchesEntityQuery(entity, normalizedQuery)).map((entity) => getEntityId(entity)),
    );

    for (const entityId of matchedIds) {
      visibleEntityIds.add(entityId);
    }

    for (const relation of model.relations) {
      if (!domainFilteredIds.has(relation.source) || !domainFilteredIds.has(relation.target)) {
        continue;
      }

      if (matchedIds.has(relation.source) || matchedIds.has(relation.target)) {
        visibleEntityIds.add(relation.source);
        visibleEntityIds.add(relation.target);
      }
    }
  }

  const entities = domainFilteredEntities.filter((entity) => visibleEntityIds.has(getEntityId(entity)));
  const relations = model.relations.filter(
    (relation) => visibleEntityIds.has(relation.source) && visibleEntityIds.has(relation.target),
  );

  return {
    entities,
    relations,
    warnings: [...model.warnings],
    domains,
    filterState: normalizedFilterState,
    visibleEntityIds: entities.map((entity) => getEntityId(entity)),
    summary: {
      totalEntities: model.entities.length,
      totalRelations: model.relations.length,
      visibleEntities: entities.length,
      visibleRelations: relations.length,
    },
  };
}

function matchesEntityQuery(entity: EntityNode, normalizedQuery: string): boolean {
  return [entity.name, entity.namespace, entity.domain].some((value) =>
    value.toLocaleLowerCase().includes(normalizedQuery),
  );
}
