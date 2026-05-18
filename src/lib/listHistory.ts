import type { Database } from "bun:sqlite";
import { isSelfHosted } from "pues/base/core";
import { getDb } from "./db.js";
import { validateTodosText } from "./todos.js";

/** Product caps — see `docs/UNDO.md` §15. */
export const MAX_LISTS_PER_USER = 50;
export const MAX_UNDO_REDO_STACK_DEPTH = 10;

export function countListsForUser(userId: number): number {
  const db = getDb();
  const row = db
    .query("SELECT COUNT(*) as c FROM lists WHERE user_id = ?")
    .get(userId) as { c: number };
  return row.c;
}

function pruneStack(
  db: Database,
  table: "undos" | "redos",
  listId: number,
): void {
  db.run(
    `DELETE FROM ${table} WHERE list_id = ? AND id NOT IN (
      SELECT id FROM (
        SELECT id FROM ${table} WHERE list_id = ? ORDER BY id DESC LIMIT ?
      )
    )`,
    listId,
    listId,
    MAX_UNDO_REDO_STACK_DEPTH,
  );
}

/**
 * Full markdown replace (§4): snapshot `oldText` onto `undos`, clear `redos`, update row.
 * No-op when byte-identical; caller should skip billing / SSE when this returns false.
 */
export function replaceListTextWithHistory(
  listId: number,
  oldText: string,
  newText: string,
  now: number,
): boolean {
  if (oldText === newText) return false;
  const db = getDb();
  const tx = db.transaction(() => {
    db.run(
      "INSERT INTO undos (list_id, text, created_at) VALUES (?, ?, ?)",
      listId,
      oldText,
      now,
    );
    pruneStack(db, "undos", listId);
    db.run("DELETE FROM redos WHERE list_id = ?", listId);
    db.run(
      "UPDATE lists SET text = ?, updated_at = ? WHERE id = ?",
      newText,
      now,
      listId,
    );
  });
  tx();
  return true;
}

export function applyUndo(
  listId: number,
  currentText: string,
): { ok: true; newText: string; now: number } | { ok: false; message: string } {
  const db = getDb();
  const top = db
    .query(
      "SELECT id, text FROM undos WHERE list_id = ? ORDER BY id DESC LIMIT 1",
    )
    .get(listId) as { id: number; text: string } | undefined;
  if (!top) return { ok: false, message: "Nothing to undo" };

  const validationError = validateTodosText(top.text, isSelfHosted());
  if (validationError) return { ok: false, message: validationError };

  const now = Math.floor(Date.now() / 1000);
  const tx = db.transaction(() => {
    db.run("DELETE FROM undos WHERE id = ?", top.id);
    db.run(
      "UPDATE lists SET text = ?, updated_at = ? WHERE id = ?",
      top.text,
      now,
      listId,
    );
    db.run(
      "INSERT INTO redos (list_id, text, created_at) VALUES (?, ?, ?)",
      listId,
      currentText,
      now,
    );
    pruneStack(db, "redos", listId);
  });
  tx();
  return { ok: true, newText: top.text, now };
}

export function applyRedo(
  listId: number,
  currentText: string,
): { ok: true; newText: string; now: number } | { ok: false; message: string } {
  const db = getDb();
  const top = db
    .query(
      "SELECT id, text FROM redos WHERE list_id = ? ORDER BY id DESC LIMIT 1",
    )
    .get(listId) as { id: number; text: string } | undefined;
  if (!top) return { ok: false, message: "Nothing to redo" };

  const validationError = validateTodosText(top.text, isSelfHosted());
  if (validationError) return { ok: false, message: validationError };

  const now = Math.floor(Date.now() / 1000);
  const tx = db.transaction(() => {
    db.run("DELETE FROM redos WHERE id = ?", top.id);
    db.run(
      "UPDATE lists SET text = ?, updated_at = ? WHERE id = ?",
      top.text,
      now,
      listId,
    );
    db.run(
      "INSERT INTO undos (list_id, text, created_at) VALUES (?, ?, ?)",
      listId,
      currentText,
      now,
    );
    pruneStack(db, "undos", listId);
  });
  tx();
  return { ok: true, newText: top.text, now };
}
