/**
 * Role-mapping loader. Reads a consumer's `config/pues.yaml`, validates each
 * mapped resource against `PRAGMA table_info`, and resolves the role contract
 * (SPEC §5.2–§5.4) into concrete column names. The result is what every other
 * piece of `base/objects/` operates on — the resolver is the single place that
 * knows about defaults, opt-outs, and passthroughs.
 */

import type { Database } from "bun:sqlite";

export type ColumnRoles = {
  pk: string;
  public_id: string;
  owner: string;
  label: string;
  position: string;
  updated_at?: string | null;
  created_at?: string | null;
  meta?: string | null;
};

export type ResourceConfig = {
  table: string;
  columns?: Partial<ColumnRoles>;
  parent?: { column: string; table: string };
  timestamp_format?: "unix" | "iso";
};

export type PuesConfig = {
  app?: { name?: string; db?: string };
  parts?: string[];
  resources?: Record<string, ResourceConfig>;
};

export type ResolvedColumns = {
  table: string;
  pk: string;
  public_id: string;
  owner: string;
  label: string;
  position: string;
  updated_at: string | null;
  created_at: string | null;
  meta: string | null;
  passthrough: string[];
  parent: { column: string; table: string } | null;
  timestamp_format: "unix" | "iso";
};

const REQUIRED_ROLES = ["pk", "public_id", "owner", "label", "position"] as const;
const OPTIONAL_ROLES = ["updated_at", "created_at", "meta"] as const;
const ALL_ROLES = [...REQUIRED_ROLES, ...OPTIONAL_ROLES] as const;

const DEFAULTS: Record<(typeof ALL_ROLES)[number], string> = {
  pk: "id",
  public_id: "ulid",
  owner: "user_id",
  label: "name",
  position: "position",
  updated_at: "updated_at",
  created_at: "created_at",
  meta: "meta",
};

// Canonical wire keys that an app column must never collide with — SPEC §5.6.
// `id` is excluded: it is the canonical wire key for the `public_id` role, but
// the column literally named `id` is almost universally the `pk` role.
const CANONICAL_RESERVED = new Set([
  "label",
  "position",
  "updated_at",
  "created_at",
  "meta",
]);

export async function loadPuesConfig(
  path: string = "config/pues.yaml",
): Promise<PuesConfig> {
  const text = await Bun.file(path).text();
  const parsed = Bun.YAML.parse(text) as PuesConfig | null;
  return parsed ?? {};
}

export function resolveColumns(
  db: Database,
  name: string,
  cfg: ResourceConfig,
): ResolvedColumns {
  if (!cfg || typeof cfg.table !== "string" || cfg.table.length === 0) {
    throw new Error(`[pues] resources.${name}: missing or empty 'table'.`);
  }

  if (cfg.columns) {
    for (const role of Object.keys(cfg.columns)) {
      if (!(ALL_ROLES as readonly string[]).includes(role)) {
        throw new Error(
          `[pues] resources.${name}.columns: unknown role "${role}". ` +
            `Valid roles: ${ALL_ROLES.join(", ")}.`,
        );
      }
    }
  }

  const info = db
    .query(`PRAGMA table_info(${quoteIdent(cfg.table)})`)
    .all() as Array<{ name: string }>;
  if (info.length === 0) {
    throw new Error(
      `[pues] resources.${name}: table "${cfg.table}" not found in the database.`,
    );
  }
  const actual = new Set(info.map((r) => r.name));

  const explicit = (cfg.columns ?? {}) as Record<string, string | null | undefined>;
  const mapped: Record<string, string | null> = {};

  for (const role of ALL_ROLES) {
    const isOptional = (OPTIONAL_ROLES as readonly string[]).includes(role);
    const v = explicit[role];

    if (v === null) {
      if (!isOptional) {
        throw new Error(
          `[pues] resources.${name}.columns.${role}: cannot opt out of a required role.`,
        );
      }
      mapped[role] = null;
      continue;
    }

    if (typeof v === "string" && v.length > 0) {
      if (!actual.has(v)) {
        throw new Error(
          `[pues] resources.${name}.columns.${role} = "${v}" — no such column on table "${cfg.table}". ` +
            `(Hint: check for typos against the actual schema.)`,
        );
      }
      mapped[role] = v;
      continue;
    }

    const def = DEFAULTS[role];
    if (actual.has(def)) {
      mapped[role] = def;
    } else if (isOptional) {
      console.log(
        `[pues] resources.${name}: optional role "${role}" dropped — no column named "${def}" on "${cfg.table}".`,
      );
      mapped[role] = null;
    } else {
      throw new Error(
        `[pues] resources.${name}: required role "${role}" defaults to column "${def}" but it is absent on "${cfg.table}". ` +
          `Add the column or map it explicitly under resources.${name}.columns.`,
      );
    }
  }

  if (cfg.parent) {
    if (!cfg.parent.column || !cfg.parent.table) {
      throw new Error(
        `[pues] resources.${name}.parent must have both 'column' and 'table'.`,
      );
    }
    if (!actual.has(cfg.parent.column)) {
      throw new Error(
        `[pues] resources.${name}.parent.column = "${cfg.parent.column}" — no such column on table "${cfg.table}".`,
      );
    }
  }

  const mappedColumns = new Set(
    Object.values(mapped).filter((v): v is string => typeof v === "string"),
  );
  const passthrough: string[] = [];
  for (const col of actual) {
    if (mappedColumns.has(col)) continue;
    if (CANONICAL_RESERVED.has(col)) {
      throw new Error(
        `[pues] Column "${col}" on "${cfg.table}" collides with a canonical wire key. ` +
          `Map it explicitly to the matching role under resources.${name}.columns, or rename the column.`,
      );
    }
    passthrough.push(col);
  }
  passthrough.sort();

  return {
    table: cfg.table,
    pk: mapped.pk!,
    public_id: mapped.public_id!,
    owner: mapped.owner!,
    label: mapped.label!,
    position: mapped.position!,
    updated_at: mapped.updated_at,
    created_at: mapped.created_at,
    meta: mapped.meta,
    passthrough,
    parent: cfg.parent ?? null,
    timestamp_format: cfg.timestamp_format ?? "unix",
  };
}

function quoteIdent(s: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) {
    throw new Error(`[pues] unsafe SQL identifier: ${JSON.stringify(s)}`);
  }
  return `"${s}"`;
}

export { quoteIdent };
