export interface ActionItemDefinition {
  label: string;
  description?: string;
  command: string;
}

export interface ActionGroupOverrideDefinition {
  title?: string;
  description?: string;
  color?: string;
  icon?: string;
  enabled?: boolean;
  actions?: ActionItemDefinition[];
}

export interface ResolvedActionGroup {
  key: string;
  title: string;
  description?: string;
  color?: string;
  icon?: string;
  actions: ActionItemDefinition[];
}

const DEFAULT_ACTION_GROUPS: readonly ResolvedActionGroup[] = [
  {
    key: 'cache',
    title: 'Cache',
    description: 'Symfony cache commands',
    color: 'charts.orange',
    icon: 'clear-all',
    actions: [
      {
        label: 'Clear cache',
        command: 'php bin/console cache:clear',
      },
    ],
  },
  {
    key: 'doctrine',
    title: 'Doctrine',
    description: 'Database, migrations, and schema commands',
    color: 'charts.blue',
    icon: 'database',
    actions: [
      {
        label: 'Create database',
        command: 'php bin/console doctrine:database:create',
      },
      {
        label: 'Dump schema',
        command: 'php bin/console doctrine:migration:dump-schema',
      },
      {
        label: 'Run migrations',
        command: 'php bin/console doctrine:migration:migrate',
      },
      {
        label: 'Validate schema',
        command: 'php bin/console doctrine:schema:validate',
      },
    ],
  },
  {
    key: 'make',
    title: 'Make',
    description: 'Symfony Maker commands',
    color: 'charts.green',
    icon: 'wrench',
    actions: [
      {
        label: 'Admin CRUD',
        command: 'php bin/console make:admin:crud',
      },
      {
        label: 'Admin dashboard',
        command: 'php bin/console make:admin:dashboard',
      },
      {
        label: 'Controller',
        command: 'php bin/console make:controller',
      },
      {
        label: 'Entity',
        command: 'php bin/console make:entity',
      },
      {
        label: 'Form',
        command: 'php bin/console make:form',
      },
      {
        label: 'Migration',
        command: 'php bin/console make:migration',
      },
    ],
  },
  {
    key: 'security',
    title: 'Security',
    description: 'Security helper commands',
    color: 'charts.red',
    icon: 'lock',
    actions: [
      {
        label: 'Hash password',
        command: 'php bin/console security:hash-password',
      },
    ],
  },
  {
    key: 'symfony',
    title: 'Symfony',
    description: 'Symfony CLI server commands',
    color: 'charts.purple',
    icon: 'server-process',
    actions: [
      {
        label: 'Stop server',
        command: 'symfony server:stop',
      },
      {
        label: 'Start server',
        command: 'symfony server:start',
      },
    ],
  },
] as const;

export function getDefaultActionGroups(): ResolvedActionGroup[] {
  return DEFAULT_ACTION_GROUPS.map(cloneResolvedActionGroup);
}

export function buildDefaultActionsConfiguration(): Record<string, ActionGroupOverrideDefinition> {
  return Object.fromEntries(
    DEFAULT_ACTION_GROUPS.map((group) => [
      group.key,
      {
        title: group.title,
        description: group.description,
        color: group.color,
        icon: group.icon,
        actions: group.actions.map((action) => ({ ...action })),
      },
    ]),
  );
}

export function resolveActionGroups(rawValue: unknown): ResolvedActionGroup[] {
  const defaultGroups = getDefaultActionGroups();
  const overrides = normalizeActionGroupOverrides(rawValue);
  const resolved: ResolvedActionGroup[] = [];
  const consumedKeys = new Set<string>();

  for (const defaultGroup of defaultGroups) {
    const override = overrides.get(defaultGroup.key);

    if (!override) {
      resolved.push(defaultGroup);
      continue;
    }

    consumedKeys.add(defaultGroup.key);

    if (override.enabled === false) {
      continue;
    }

    resolved.push(mergeResolvedDefaultGroup(defaultGroup, override));
  }

  for (const [groupKey, override] of overrides.entries()) {
    if (consumedKeys.has(groupKey) || override.enabled === false) {
      continue;
    }

    const parsedOverride = parseCustomResolvedGroup(groupKey, override);

    if (parsedOverride) {
      resolved.push(parsedOverride);
    }
  }

  return resolved;
}

export function normalizeActionGroupOverrides(rawValue: unknown): Map<string, ActionGroupOverrideDefinition> {
  const normalized = new Map<string, ActionGroupOverrideDefinition>();

  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    return normalized;
  }

  for (const [rawKey, rawGroup] of Object.entries(rawValue)) {
    const key = normalizeGroupKey(rawKey);

    if (!key || !rawGroup || typeof rawGroup !== 'object' || Array.isArray(rawGroup)) {
      continue;
    }

    const candidate = rawGroup as Record<string, unknown>;
    const actions = Array.isArray(candidate.actions)
      ? candidate.actions
        .map(parseActionItem)
        .filter((action): action is ActionItemDefinition => action !== undefined)
      : undefined;

    normalized.set(key, {
      title: typeof candidate.title === 'string' ? candidate.title.trim() : undefined,
      description: typeof candidate.description === 'string' ? candidate.description.trim() : undefined,
      color: normalizeThemeColorId(candidate.color),
      icon: normalizeIconName(typeof candidate.icon === 'string' ? candidate.icon : undefined),
      enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : undefined,
      actions,
    });
  }

  return normalized;
}

export function normalizeGroupKey(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeIconName(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  const codiconMatch = /^\$\((.+)\)$/.exec(trimmed);

  return (codiconMatch?.[1] ?? trimmed).trim() || undefined;
}

export function isThemeColorId(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeThemeColorId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();

  return isThemeColorId(trimmed) ? trimmed : undefined;
}

function mergeResolvedDefaultGroup(
  defaultGroup: ResolvedActionGroup,
  override: ActionGroupOverrideDefinition,
): ResolvedActionGroup {
  return {
    key: defaultGroup.key,
    title: typeof override.title === 'string' && override.title.trim().length > 0 ? override.title.trim() : defaultGroup.title,
    description:
      typeof override.description === 'string' && override.description.trim().length > 0
        ? override.description.trim()
        : defaultGroup.description,
    color: override.color ?? defaultGroup.color,
    icon: override.icon ?? defaultGroup.icon,
    actions:
      Array.isArray(override.actions) && override.actions.length > 0
        ? override.actions.map((action) => ({ ...action }))
        : defaultGroup.actions.map((action) => ({ ...action })),
  };
}

function parseCustomResolvedGroup(key: string, group: ActionGroupOverrideDefinition): ResolvedActionGroup | undefined {
  if (!Array.isArray(group.actions) || group.actions.length === 0) {
    return undefined;
  }

  return {
    key,
    title: typeof group.title === 'string' && group.title.trim().length > 0 ? group.title.trim() : titleizeKey(key),
    description:
      typeof group.description === 'string' && group.description.trim().length > 0
        ? group.description.trim()
        : undefined,
    color: group.color,
    icon: group.icon,
    actions: group.actions.map((action) => ({ ...action })),
  };
}

function parseActionItem(rawValue: unknown): ActionItemDefinition | undefined {
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    return undefined;
  }

  const candidate = rawValue as Record<string, unknown>;
  const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
  const command = typeof candidate.command === 'string' ? candidate.command.trim() : '';

  if (!label || !command) {
    return undefined;
  }

  const description = typeof candidate.description === 'string' ? candidate.description.trim() : undefined;

  return {
    label,
    description: description || undefined,
    command,
  };
}

function titleizeKey(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function cloneResolvedActionGroup(group: ResolvedActionGroup): ResolvedActionGroup {
  return {
    ...group,
    actions: group.actions.map((action) => ({ ...action })),
  };
}
