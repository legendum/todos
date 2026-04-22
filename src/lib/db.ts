import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT_DIR = resolve(import.meta.dir, "../..");

let db: Database | null = null;

export function getDb(): Database {
  if (!db) {
    const path = resolve(
      ROOT_DIR,
      process.env.TODOS_DB_PATH || "data/todos.db",
    );
    mkdirSync(dirname(path), { recursive: true });
    db = new Database(path, { create: true });
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA foreign_keys = ON");
    applyMigrations();
    runSchema();
  }
  return db;
}

function applyMigrations(): void {
  const listsExists = db!
    .query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='lists'")
    .get();
  if (listsExists) return;

  try {
    const sql = readFileSync(
      join(ROOT_DIR, "config/migrate-categories-to-lists.sql"),
      "utf-8",
    );
    db!.transaction(() => db!.exec(sql))();
  } catch {
    // Fresh install: no legacy table to rename; schema.sql will create lists
  }
}

function runSchema(): void {
  const schemaPath = join(ROOT_DIR, "config/schema.sql");
  try {
    const sql = readFileSync(schemaPath, "utf-8");
    db!.exec(sql);
  } catch (e) {
    console.warn("Could not run schema.sql", e);
  }
}
