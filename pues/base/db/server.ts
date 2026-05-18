// Server-only barrel for `pues/base/db/`. SQLite is server-only by
// definition, so the part ships a single barrel (SPEC §9.6) — there
// is no `pues/base/db` client surface; importing the default path
// fails fast at module resolution rather than silently bundling
// server code into the browser.

export { type DbConfig, readDbConfig } from "./config";
export { getDb, resetDbForTesting, setDbRoot } from "./getDb";
export { applyMigrations } from "./migrations";
export { applySchema } from "./schema";
