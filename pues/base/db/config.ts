/**
 * Read + validate the `db:` section of `<root>/config/pues.yaml`.
 *
 * Used by `getDb()` at process boot. Throws if the file is missing,
 * unparseable, or the section absent — the contract is "if `db` is in
 * `pues:`, `db:` is required" (SPEC §9.1 part-keyed config rule).
 *
 * Synchronous because `getDb()` itself is synchronous (existing pues
 * call sites — `configureAuth({ getDb })`, `mountResource({ db: getDb() })`
 * — assume that). The db part reads pues.yaml directly rather than
 * going through `base/objects/loadPuesConfig`, so a consumer vendoring
 * `db` is not forced to also vendor `objects`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export type DbConfig = {
  /** Path to the SQLite file. Relative paths resolve against `root`. */
  path: string;
};

export function readDbConfig(root: string): DbConfig {
  const yamlPath = join(root, "config/pues.yaml");
  let text: string;
  try {
    text = readFileSync(yamlPath, "utf8");
  } catch (cause) {
    throw new Error(`[pues/db] could not read ${yamlPath}`, { cause });
  }

  const parsed = Bun.YAML.parse(text) as { db?: DbConfig } | null;
  const db = parsed?.db;
  if (!db) {
    throw new Error(
      `[pues/db] ${yamlPath} is missing the required 'db:' section. ` +
        `If 'db' is in 'pues:', a top-level 'db:' key is required ` +
        `(SPEC §9.1 part-keyed config).`,
    );
  }
  if (typeof db.path !== "string" || db.path.length === 0) {
    throw new Error(
      `[pues/db] ${yamlPath} 'db.path' is required and must be a non-empty string.`,
    );
  }

  return { path: db.path };
}
