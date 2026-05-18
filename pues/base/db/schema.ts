/**
 * `applySchema(db, root)` — load `<root>/config/schema.sql` and run
 * it against the database. Pues consumers keep their canonical schema
 * additive (everything wrapped in `CREATE TABLE IF NOT EXISTS …`,
 * `CREATE INDEX IF NOT EXISTS …`, etc. — see SPEC §1), so re-running
 * schema.sql on every `getDb()` is idempotent.
 *
 * Missing `schema.sql` is treated as a hard error: a consumer that
 * vendors `base/db/` has opted into the convention that `schema.sql`
 * is the schema source.
 */

import type { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function applySchema(db: Database, root: string): void {
  const schemaPath = join(root, "config/schema.sql");
  let sql: string;
  try {
    sql = readFileSync(schemaPath, "utf8");
  } catch (cause) {
    throw new Error(`[pues/db] could not read ${schemaPath}`, { cause });
  }
  db.exec(sql);
}
