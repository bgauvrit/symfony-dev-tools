import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  getEntityId,
  type EntityDiagramModel,
  type EntityField,
  type EntityNode,
  type RelationEdge,
  type RelationKind,
} from './model';

const PHPParser = require('php-parser');

type AstNode = Record<string, any>;

interface ParsedEntity {
  entity: EntityNode;
  classLine: number;
  entityType: 'Entity' | 'MappedSuperclass';
  relations: RelationCandidate[];
}

interface RelationCandidate {
  source: string;
  target: string;
  kind: RelationKind;
  label: string;
  mappedBy?: string;
  inversedBy?: string;
  nullable: boolean;
}

const SCALAR_TYPES = new Set([
  'array',
  'bool',
  'float',
  'int',
  'iterable',
  'mixed',
  'null',
  'resource',
  'scalar',
  'string',
  'void',
  'DateTime',
  'DateTimeImmutable',
  'DateTimeInterface',
]);

const parser = new PHPParser.Engine({
  parser: {
    extractDoc: true,
    php7: true,
  },
  ast: {
    withPositions: true,
  },
});

export async function scanEntityRoots(
  roots: string[],
  options: {
    includeMappedSuperclass?: boolean;
    textOverrides?: Map<string, string>;
  } = {},
): Promise<EntityDiagramModel> {
  const includeMappedSuperclass = options.includeMappedSuperclass ?? false;
  const textOverrides = options.textOverrides ?? new Map<string, string>();
  const warnings: string[] = [];
  const parsedEntities: ParsedEntity[] = [];

  if (roots.length === 0) {
    warnings.push('Aucun dossier d’entités configuré.');
  }

  for (const root of roots) {
    try {
      const stat = await fs.stat(root);

      if (!stat.isDirectory()) {
        warnings.push(`Le chemin d’entités n’est pas un dossier: ${root}`);
        continue;
      }
    } catch {
      warnings.push(`Dossier d’entités introuvable: ${root}`);
      continue;
    }

    const files = await collectPhpFiles(root);

    for (const filePath of files) {
      try {
        const parsed = await parseEntityFile(filePath, root, includeMappedSuperclass, textOverrides);

        if (parsed) {
          parsedEntities.push(parsed);
        }
      } catch (error) {
        warnings.push(formatError(`Erreur de scan pour ${filePath}`, error));
      }
    }
  }

  const entities = parsedEntities
    .filter((entry) => entry.entityType === 'Entity' || includeMappedSuperclass)
    .map((entry) => entry.entity)
    .sort((left, right) => getEntityId(left).localeCompare(getEntityId(right)));

  const entityMap = new Map<string, ParsedEntity>();

  for (const entry of parsedEntities) {
    if (entry.entityType === 'Entity' || includeMappedSuperclass) {
      entityMap.set(getEntityId(entry.entity), entry);
    }
  }

  const relations = normalizeRelations(entityMap, warnings);
  const classToFilePath: Record<string, string> = {};
  const classToLine: Record<string, number> = {};
  const aliases: Record<string, string> = {};

  for (const entry of entityMap.values()) {
    const entityId = getEntityId(entry.entity);
    classToFilePath[entityId] = entry.entity.filePath;
    classToLine[entityId] = entry.classLine;
    aliases[entityId] = buildDiagramAlias(entityId);
  }

  return {
    entities,
    relations,
    warnings,
    generatedAt: new Date().toISOString(),
    classToFilePath,
    classToLine,
    aliases,
  };
}

export function isEntityFile(documentPath: string, roots: string[]): boolean {
  const normalizedPath = path.normalize(documentPath);

  return roots.some((root) => {
    const normalizedRoot = path.normalize(root);

    return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}${path.sep}`);
  });
}

async function collectPhpFiles(root: string): Promise<string[]> {
  const collected: string[] = [];
  const entries = await fs.readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const nextPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      collected.push(...(await collectPhpFiles(nextPath)));
      continue;
    }

    if (entry.isFile() && nextPath.endsWith('.php')) {
      collected.push(nextPath);
    }
  }

  return collected.sort((left, right) => left.localeCompare(right));
}

async function parseEntityFile(
  filePath: string,
  entityRoot: string,
  includeMappedSuperclass: boolean,
  textOverrides: Map<string, string>,
): Promise<ParsedEntity | undefined> {
  const normalizedFilePath = path.normalize(filePath);
  const code = textOverrides.get(normalizedFilePath) ?? (await fs.readFile(filePath, 'utf8'));
  const ast = parser.parseCode(code) as AstNode;
  const namespaceNode = ast.children?.find((node: AstNode) => node.kind === 'namespace') as AstNode | undefined;

  if (!namespaceNode) {
    return undefined;
  }

  const namespace = namespaceNode.name;
  const classNode = namespaceNode.children?.find((node: AstNode) => node.kind === 'class') as AstNode | undefined;

  if (!classNode || !classNode.name?.name) {
    return undefined;
  }

  const classAttributeNames = getAttributeNames(classNode.attrGroups);
  const isEntity = classAttributeNames.has('Entity');
  const isMappedSuperclass = classAttributeNames.has('MappedSuperclass');

  if (!isEntity && !(includeMappedSuperclass && isMappedSuperclass) && !isMappedSuperclass) {
    return undefined;
  }

  if (!isEntity && !isMappedSuperclass) {
    return undefined;
  }

  const entityType = isEntity ? 'Entity' : 'MappedSuperclass';
  const uses = collectUses(namespaceNode.children ?? []);
  const entity: EntityNode = {
    name: classNode.name.name,
    namespace,
    domain: inferDomain(entityRoot, filePath),
    filePath: path.normalize(filePath),
    fields: [],
  };

  const relations: RelationCandidate[] = [];

  for (const member of classNode.body ?? []) {
    if (member.kind !== 'propertystatement') {
      continue;
    }

    for (const property of member.properties ?? []) {
      const propertyName = property.name?.name;

      if (!propertyName) {
        continue;
      }

      const propertyAttributes = getAttributes(property.attrGroups);
      const relationKind = getRelationKind(propertyAttributes);

      if (relationKind) {
        const relation = buildRelationCandidate(
          property,
          propertyName,
          relationKind,
          entity,
          propertyAttributes,
          namespace,
          uses,
        );

        if (relation) {
          relations.push(relation);
        }

        continue;
      }

      const field = buildEntityField(property, propertyName, propertyAttributes);

      if (field) {
        entity.fields.push(field);
      }
    }
  }

  return {
    entity,
    classLine: classNode.loc?.start?.line ?? 1,
    entityType,
    relations,
  };
}

function collectUses(nodes: AstNode[]): Map<string, string> {
  const uses = new Map<string, string>();

  for (const node of nodes) {
    if (node.kind !== 'usegroup') {
      continue;
    }

    for (const item of node.items ?? []) {
      const resolved = node.name ? `${node.name}\\${item.name}` : item.name;
      const alias = item.alias?.name ?? getShortName(item.name);
      uses.set(alias, resolved);
    }
  }

  return uses;
}

function getAttributes(attrGroups: AstNode[] | undefined): Map<string, AstNode> {
  const attributes = new Map<string, AstNode>();

  for (const group of attrGroups ?? []) {
    for (const attribute of group.attrs ?? []) {
      attributes.set(getShortName(attribute.name), attribute);
    }
  }

  return attributes;
}

function getAttributeNames(attrGroups: AstNode[] | undefined): Set<string> {
  return new Set(Array.from(getAttributes(attrGroups).keys()));
}

function getRelationKind(attributes: Map<string, AstNode>): RelationKind | undefined {
  const relationKinds: RelationKind[] = ['ManyToOne', 'OneToMany', 'OneToOne', 'ManyToMany'];

  return relationKinds.find((kind) => attributes.has(kind));
}

function buildRelationCandidate(
  property: AstNode,
  propertyName: string,
  relationKind: RelationKind,
  entity: EntityNode,
  attributes: Map<string, AstNode>,
  namespace: string,
  uses: Map<string, string>,
): RelationCandidate | undefined {
  const relationAttribute = attributes.get(relationKind);

  if (!relationAttribute) {
    return undefined;
  }

  const relationArgs = getNamedArguments(relationAttribute.args);
  const joinColumnArgs = getNamedArguments(attributes.get('JoinColumn')?.args);
  const explicitTarget = relationArgs.targetEntity
    ? resolveClassName(String(relationArgs.targetEntity), namespace, uses)
    : undefined;
  const propertyType = getPropertyType(property);
  const resolvedPropertyType = propertyType ? resolveClassName(stripNullablePrefix(propertyType), namespace, uses) : undefined;
  const target = explicitTarget ?? resolvedPropertyType;

  if (!target) {
    return undefined;
  }

  const nullable = readNullable(joinColumnArgs.nullable, property.nullable);

  return {
    source: getEntityId(entity),
    target,
    kind: relationKind,
    label: propertyName,
    mappedBy: asOptionalString(relationArgs.mappedBy),
    inversedBy: asOptionalString(relationArgs.inversedBy),
    nullable,
  };
}

function buildEntityField(
  property: AstNode,
  propertyName: string,
  attributes: Map<string, AstNode>,
): EntityField | undefined {
  const propertyType = getPropertyType(property);
  const normalizedType = propertyType ? normalizeDisplayType(propertyType) : 'mixed';
  const hasColumn = attributes.has('Column');

  if (!hasColumn && !isScalarLike(normalizedType)) {
    return undefined;
  }

  return {
    name: propertyName,
    type: normalizedType,
    nullable: Boolean(property.nullable),
  };
}

function getNamedArguments(args: AstNode[] | undefined): Record<string, unknown> {
  const namedArguments: Record<string, unknown> = {};

  for (const argument of args ?? []) {
    if (argument.kind === 'namedargument') {
      namedArguments[argument.name] = parseArgumentValue(argument.value);
      continue;
    }

    namedArguments[String(Object.keys(namedArguments).length)] = parseArgumentValue(argument);
  }

  return namedArguments;
}

function parseArgumentValue(node: AstNode | undefined): unknown {
  if (!node) {
    return undefined;
  }

  switch (node.kind) {
    case 'boolean':
      return Boolean(node.value);
    case 'number':
      return Number(node.value);
    case 'nullkeyword':
      return null;
    case 'string':
      return node.value;
    case 'array':
      return (node.items ?? []).map((entry: AstNode) => parseArgumentValue(entry.value ?? entry));
    case 'name':
      return node.name;
    case 'staticlookup':
      if (node.offset?.name === 'class') {
        return node.what?.name ?? undefined;
      }

      return `${node.what?.name ?? ''}::${node.offset?.name ?? ''}`;
    default:
      return undefined;
  }
}

function getPropertyType(property: AstNode): string | undefined {
  return flattenTypeNode(property.type, property.nullable);
}

function flattenTypeNode(typeNode: AstNode | undefined, nullable: boolean): string | undefined {
  if (!typeNode) {
    return undefined;
  }

  switch (typeNode.kind) {
    case 'name':
      return prefixNullable(typeNode.name, nullable);
    case 'typereference':
      return prefixNullable(typeNode.name, nullable);
    case 'uniontype':
      return (typeNode.types ?? []).map((entry: AstNode) => flattenTypeNode(entry, false)).filter(Boolean).join('|');
    case 'intersectiontype':
      return (typeNode.types ?? []).map((entry: AstNode) => flattenTypeNode(entry, false)).filter(Boolean).join('&');
    default:
      return undefined;
  }
}

function prefixNullable(typeName: string, nullable: boolean): string {
  const normalized = String(typeName);

  if (!nullable || normalized.startsWith('?')) {
    return normalized;
  }

  return `?${normalized}`;
}

function readNullable(value: unknown, propertyNullable: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  return Boolean(propertyNullable);
}

function resolveClassName(rawName: string, namespace: string, uses: Map<string, string>): string {
  if (!rawName || isScalarName(rawName)) {
    return rawName;
  }

  const trimmed = stripNullablePrefix(rawName);

  if (trimmed.startsWith('\\')) {
    return trimmed.slice(1);
  }

  const [head, ...tail] = trimmed.split('\\');
  const imported = uses.get(head);

  if (imported) {
    return [imported, ...tail].filter(Boolean).join('\\');
  }

  if (trimmed.includes('\\')) {
    return trimmed;
  }

  return `${namespace}\\${trimmed}`;
}

function normalizeRelations(
  entities: Map<string, ParsedEntity>,
  warnings: string[],
): RelationEdge[] {
  const relations: RelationEdge[] = [];
  const seen = new Set<string>();

  for (const parsedEntity of entities.values()) {
    for (const relation of parsedEntity.relations) {
      if (!entities.has(relation.target)) {
        warnings.push(`Relation non résolue ignorée: ${relation.source} -> ${relation.target} (${relation.kind})`);
        continue;
      }

      if (relation.kind === 'OneToMany') {
        if (hasCounterpart(entities, relation, ['ManyToOne', 'OneToOne'])) {
          continue;
        }

        pushRelation(relations, seen, {
          source: relation.target,
          target: relation.source,
          kind: 'ManyToOne',
          sourceMultiplicity: '0..*',
          targetMultiplicity: '0..1',
          label: relation.mappedBy ?? relation.label,
        });
        continue;
      }

      if (relation.kind === 'ManyToMany') {
        if (relation.mappedBy && hasCounterpart(entities, relation, ['ManyToMany'])) {
          continue;
        }

        pushRelation(relations, seen, {
          source: relation.source,
          target: relation.target,
          kind: relation.kind,
          sourceMultiplicity: '0..*',
          targetMultiplicity: '0..*',
          label: relation.label,
        });
        continue;
      }

      if (relation.kind === 'OneToOne') {
        if (relation.mappedBy && hasCounterpart(entities, relation, ['OneToOne'])) {
          continue;
        }

        pushRelation(relations, seen, {
          source: relation.source,
          target: relation.target,
          kind: relation.kind,
          sourceMultiplicity: '0..1',
          targetMultiplicity: relation.nullable ? '0..1' : '1',
          label: relation.label,
        });
        continue;
      }

      pushRelation(relations, seen, {
        source: relation.source,
        target: relation.target,
        kind: relation.kind,
        sourceMultiplicity: '0..*',
        targetMultiplicity: relation.nullable ? '0..1' : '1',
        label: relation.label,
      });
    }
  }

  return relations.sort((left, right) =>
    `${left.source}:${left.label}:${left.target}`.localeCompare(`${right.source}:${right.label}:${right.target}`),
  );
}

function hasCounterpart(
  entities: Map<string, ParsedEntity>,
  relation: RelationCandidate,
  kinds: RelationKind[],
): boolean {
  const targetEntity = entities.get(relation.target);

  if (!targetEntity || !relation.mappedBy) {
    return false;
  }

  return targetEntity.relations.some(
    (candidate) =>
      candidate.source === relation.target &&
      candidate.target === relation.source &&
      candidate.label === relation.mappedBy &&
      kinds.includes(candidate.kind),
  );
}

function pushRelation(relations: RelationEdge[], seen: Set<string>, relation: RelationEdge): void {
  const key = `${relation.source}|${relation.target}|${relation.kind}|${relation.label}|${relation.sourceMultiplicity}|${relation.targetMultiplicity}`;

  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  relations.push(relation);
}

function inferDomain(entityRoot: string, filePath: string): string {
  const relativePath = path.relative(entityRoot, filePath);
  const firstSegment = relativePath.split(path.sep)[0];

  if (!firstSegment || firstSegment.endsWith('.php')) {
    return 'Entity';
  }

  return firstSegment;
}

function buildDiagramAlias(entityId: string): string {
  return entityId.replace(/[^A-Za-z0-9_]/g, '_');
}

function normalizeDisplayType(typeName: string): string {
  return typeName
    .split('|')
    .map((part) => stripNullablePrefix(part.trim()))
    .map((part) => getShortName(part))
    .join('|');
}

function stripNullablePrefix(typeName: string): string {
  return typeName.replace(/^\?/, '');
}

function getShortName(typeName: string): string {
  const normalized = typeName.replace(/^\?/, '').replace(/^\\/, '');
  const parts = normalized.split('\\');

  return parts[parts.length - 1] ?? normalized;
}

function isScalarLike(typeName: string): boolean {
  return typeName
    .split(/[|&]/)
    .map((part) => part.trim())
    .every((part) => SCALAR_TYPES.has(stripNullablePrefix(part)));
}

function isScalarName(typeName: string): boolean {
  return SCALAR_TYPES.has(stripNullablePrefix(typeName));
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function formatError(prefix: string, error: unknown): string {
  if (error instanceof Error) {
    return `${prefix}: ${error.message}`;
  }

  return prefix;
}
