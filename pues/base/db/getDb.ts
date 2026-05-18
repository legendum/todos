/**
 * `getDb()` — process-singleton bun:sqlite handle. On first call:
 *
 *   1. Reads `config/pues.yaml`'s `db:` section to find the DB path.
 *   2. Opens the file (`create: true`), making parent directories
 *      as needed.
 *   3. Enables WAL + foreign keys (pues bakes both — no opt).
 *   4. Applies `config/schema.sql` (idempotent additive schema).
 *   5. Walks `config/migrations/` in lex order, applying any not
 *      already recorded in the `migrations` tracking table.
 *
 * Subsequent calls return the cached handle. Synchronous — existing
 * pues call sites (`configureAuth({ getDb })`, `mountResource({ db:
 * getDb() })`) assume that.
 *
 * The root for relative paths is derived from this module's location:
 * the vendored layout is `<root>/pues/base/db/getDb.ts`, so the root
 * is three directories up. Override via `setDbRoot(root)` before the
 * first `getDb()` call if your consumer wraps pues in an unusual
 * layout.
 *
 * `PUES_DB_PATH` env var overrides the `db.path` from pues.yaml. Used
 * by tests (point at a tmpdir DB without rewriting config) and dev
 * (point at a separate dev DB without touching the file). Schema +
 * migrations still resolve from the same root; only the DB file moves.
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { readDbConfig } from "./config";
import { applyMigrations } from "./migrations";
import { applySchema } from "./schema";

let cached: Database | null = null;
let cachedRoot: string | null = null;

function defaultRoot(): string {
  return resolve(import.meta.dirname, "../../..");
}

/**
 * Override the root pues uses to resolve `config/pues.yaml`,
 * `config/schema.sql`, and `config/migrations/`. Call before
 * `getDb()`; throws if the handle is already open.
 */
export function setDbRoot(root: string): void {
  if (cached) {
    throw new Error("[pues/db] setDbRoot must be called before getDb()");
  }
  cachedRoot = root;
}

export function getDb(): Database {
  if (cached) return cached;

  const root = cachedRoot ?? defaultRoot();
  const cfg = readDbConfig(root);
  const configuredPath = process.env.PUES_DB_PATH ?? cfg.path;
  const dbPath = isAbsolute(configuredPath)
    ? configuredPath
    : resolve(root, configuredPath);

  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  applySchema(db, root);
  applyMigrations(db, root);

  cached = db;
  return db;
}

/**
 * Test-only: drop the cached handle so the next `getDb()` re-opens.
 * Does not close the underlying file.
 */
export function resetDbForTesting(): void {
  cached = null;
  cachedRoot = null;
}
