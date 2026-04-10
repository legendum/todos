import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

let db: Database | null = null;

export function getDb(): Database {
  if (!db) {
    const path = join(process.cwd(), process.env.TODOS_DB_PATH || "data/todos.db");
    mkdirSync(dirname(path), { recursive: true });
    db = new Database(path, { create: true });
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA foreign_keys = ON");
    runSchema();
  }
  return db;
}

function runSchema(): void {
  const schemaPath = join(process.cwd(), "schema.sql");
  try {
    const sql = readFileSync(schemaPath, "utf-8");
    db!.exec(sql);
  } catch (e) {
    console.warn("Could not run schema.sql", e);
  }
}
