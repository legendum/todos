/**
 * `applyMigrations(db, root)` — walk `<root>/config/migrations/` in
 * lexicographic order and apply every `.sql` file not already
 * recorded in the `migrations` tracking table. Each pending file
 * applies inside a single transaction together with its
 * `INSERT INTO migrations` row, so a mid-migration failure leaves the
 * database untouched and the migration is retried on next boot.
 *
 * The tracking table is created (idempotently) on every call, so a
 * fresh database picks it up automatically and a consumer that adds
 * migrations later does not need to ship a bootstrap migration.
 *
 * Missing `config/migrations/` directory is a no-op — consumers that
 * stick to additive `IF NOT EXISTS` schemas never need a migrations
 * folder.
 *
 * Lexicographic order is the contract. Number your files with a
 * leading zero-padded prefix (`001_init.sql`, `002_add_position.sql`)
 * so the alphabetical sort matches the intended chronology.
 */

import type { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TRACKING_TABLE = "migrations";

function ensureTrackingTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (
      migration  TEXT    PRIMARY KEY,
      applied_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );
  `);
}

function appliedSet(db: Database): Set<string> {
  const rows = db
    .query<{ migration: string }, []>(`SELECT migration FROM ${TRACKING_TABLE}`)
    .all();
  return new Set(rows.map((r) => r.migration));
}

export function applyMigrations(db: Database, root: string): void {
  ensureTrackingTable(db);

  const dir = join(root, "config/migrations");
  if (!existsSync(dir)) return;

  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort(); // lexicographic — matches chronology when prefixed with 001_, 002_, ...

  const already = appliedSet(db);

  const record = db.prepare(
    `INSERT INTO ${TRACKING_TABLE} (migration) VALUES (?)`,
  );

  for (const name of files) {
    if (already.has(name)) continue;
    const sql = readFileSync(join(dir, name), "utf8");
    db.transaction(() => {
      db.exec(sql);
      record.run(name);
    })();
  }
}
