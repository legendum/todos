import type { Row } from "pues/base/objects";
import { countTodos } from "../lib/todos.js";
import type { ListEntry } from "./offlineDb";

/**
 * Project a pues canonical wire row (id, label, position, updated_at,
 * + slug/text passthroughs) into the `ListEntry` shape the rest of
 * the todos web layer consumes. Single source of truth — used by both
 * the live home list (`Lists.tsx`) and the offline reconcile path
 * (`syncMarkdown.ts`) that pulls `/api/lists` after a reconnect.
 */
export function wireRowToListEntry(row: Row): ListEntry {
  const text = typeof row.text === "string" ? row.text : "";
  const { total, done } = countTodos(text);
  return {
    name: row.label,
    slug: typeof row.slug === "string" ? row.slug : "",
    ulid: String(row.id),
    position: row.position,
    total,
    done,
    updated_at: typeof row.updated_at === "number" ? row.updated_at : 0,
  };
}
