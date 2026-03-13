export type RelationKind = 'ManyToOne' | 'OneToMany' | 'OneToOne' | 'ManyToMany';

export interface EntityField {
  name: string;
  type: string;
  nullable: boolean;
}

export interface EntityNode {
  name: string;
  namespace: string;
  domain: string;
  filePath: string;
  fields: EntityField[];
}

export interface RelationEdge {
  source: string;
  target: string;
  kind: RelationKind;
  sourceMultiplicity: string;
  targetMultiplicity: string;
  label: string;
}

export interface DiagramFilterState {
  query: string;
  includedDomains: string[];
}

export interface DiagramSummary {
  totalEntities: number;
  totalRelations: number;
  visibleEntities: number;
  visibleRelations: number;
}

export interface EntityDiagramModel {
  entities: EntityNode[];
  relations: RelationEdge[];
  warnings: string[];
  generatedAt: string;
  classToFilePath: Record<string, string>;
  classToLine: Record<string, number>;
  aliases: Record<string, string>;
}

export interface FilteredEntityDiagramModel {
  entities: EntityNode[];
  relations: RelationEdge[];
  warnings: string[];
  domains: string[];
  filterState: DiagramFilterState;
  visibleEntityIds: string[];
  summary: DiagramSummary;
}

export interface EntityDiagramRenderPayload extends FilteredEntityDiagramModel {
  svg: string | undefined;
}

export function getEntityId(entity: Pick<EntityNode, 'namespace' | 'name'>): string {
  return `${entity.namespace}\\${entity.name}`;
}

export function getEntityShortName(entityId: string): string {
  const segments = entityId.split('\\');

  return segments[segments.length - 1] ?? entityId;
}
