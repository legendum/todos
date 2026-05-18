/**
 * List handlers — markdown text editor + doc-history undo/redo.
 *
 * Index / create / rename / delete / reorder / lists-SSE used to live here.
 * Those are now served by pues' `mountResource` for `lists` (see
 * `src/api/server.ts`) and pues' `/api/events` stream. The handlers in this
 * file are the bespoke paths that pues doesn't own: writing the `text`
 * passthrough column (the actual list markdown), reading it back, and the
 * undo/redo stacks that live in separate `undos`/`redos` tables.
 *
 * Whenever this file mutates `lists.text`, it broadcasts a canonical
 * `lists.updated` event via `broadcastListUpdated` so the home page (also
 * subscribed to `/api/events`) re-renders done/total counts live.
 */

import { isSelfHosted } from "pues/base/core";
import { getDb } from "../../lib/db.js";
import {
  applyRedo,
  applyUndo,
  replaceListTextWithHistory,
} from "../../lib/listHistory.js";
import { broadcast } from "../../lib/sse.js";
import { countTodos, validateTodosText } from "../../lib/todos.js";
import { json } from "../json.js";
import { broadcastListUpdated } from "../pues-runtime.js";

type ListRow = {
  id: number;
  user_id: number;
  ulid: string;
  name: string;
  slug: string;
  position: number;
  text: string;
  created_at: number;
  updated_at: number;
};

type ListRowDocHistory = Pick<
  ListRow,
  | "id"
  | "ulid"
  | "user_id"
  | "text"
  | "name"
  | "slug"
  | "position"
  | "created_at"
  | "updated_at"
>;

/**
 * Apply one document undo/redo step: DB mutation + SSE for list body (webhook
 * stream) + SSE for the lists index (pues `/api/events`).
 * Used by webhook and authenticated `POST /:slug/undo|redo`.
 */
export function runDocHistoryMutation(
  row: ListRowDocHistory,
  apply: typeof applyUndo,
):
  | { ok: false; response: Response }
  | { ok: true; newText: string; now: number; row: ListRowDocHistory } {
  const result = apply(row.id, row.text);
  if (!result.ok) {
    return {
      ok: false,
      response: json({ error: "conflict", message: result.message }, 409),
    };
  }
  broadcast(row.ulid, result.newText);
  broadcastListUpdated({
    ...row,
    text: result.newText,
    updated_at: result.now,
  });
  return {
    ok: true,
    newText: result.newText,
    now: result.now,
    row,
  };
}

/** GET /:slug — get todos (supports content negotiation). `null` means serve SPA HTML. */
export function getTodos(
  req: Request,
  listSlug: string,
  userId: number,
): Response | null {
  const db = getDb();

  // Strip extension for content negotiation
  let format = "html";
  let slug = listSlug;
  if (slug.endsWith(".md")) {
    format = "text";
    slug = slug.slice(0, -3);
  } else if (slug.endsWith(".json")) {
    format = "json";
    slug = slug.slice(0, -5);
  } else {
    const accept = req.headers.get("Accept") ?? "";
    if (accept.includes("application/json")) format = "json";
    else if (accept.includes("text/plain") || accept.includes("text/markdown"))
      format = "text";
  }

  const row = db
    .query(
      "SELECT ulid, name, slug, text, position, updated_at, created_at FROM lists WHERE user_id = ? AND slug = ?",
    )
    .get(userId, slug) as ListRow | undefined;

  if (!row) return json({ error: "not_found", reason: "list" }, 404);

  if (format === "text") {
    return new Response(row.text, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "X-Updated-At": String(row.updated_at ?? row.created_at),
      },
    });
  }

  if (format === "json") {
    const { total, done } = countTodos(row.text);
    return json({
      name: row.name,
      slug: row.slug,
      ulid: row.ulid,
      text: row.text,
      total,
      done,
      updated_at: row.updated_at ?? row.created_at,
    });
  }

  // HTML — return null to signal the server should serve the SPA
  return null;
}

/** Read a string-valued field from a parsed JSON value. Returns undefined if missing or not a string. */
function getStringField(obj: unknown, field: string): string | undefined {
  if (typeof obj !== "object" || obj === null) return undefined;
  const value = (obj as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}

/** PUT or POST /:slug — replace all todos (raw markdown or JSON `{ markdown }` / `{ text }`). */
export async function replaceTodos(
  req: Request,
  listSlug: string,
  userId: number,
): Promise<Response> {
  const db = getDb();
  const row = db
    .query(
      "SELECT id, user_id, ulid, name, slug, position, text, updated_at, created_at FROM lists WHERE user_id = ? AND slug = ?",
    )
    .get(userId, listSlug) as ListRow | undefined;

  if (!row) return json({ error: "not_found", reason: "list" }, 404);

  const ct = req.headers.get("Content-Type") ?? "";
  let text: string;
  if (ct.includes("application/json")) {
    let parsed: unknown;
    try {
      parsed = await req.json();
    } catch {
      return json({ error: "invalid_request", message: "Invalid JSON" }, 400);
    }
    // `markdown` is the documented field; `text` is accepted as an alias for
    // backwards compatibility with earlier callers.
    const body =
      getStringField(parsed, "markdown") ?? getStringField(parsed, "text");
    if (body === undefined) {
      return json(
        {
          error: "invalid_request",
          message:
            "JSON body must include a string markdown or text field (full document)",
        },
        400,
      );
    }
    text = body;
  } else {
    text = await req.text();
  }
  const validationError = validateTodosText(text, isSelfHosted());
  if (validationError) {
    return json({ error: "invalid_request", message: validationError }, 400);
  }

  if (text === row.text) {
    const { total, done } = countTodos(text);
    const updated_at = row.updated_at ?? row.created_at;
    return json({
      name: row.name,
      slug: row.slug,
      ulid: row.ulid,
      text,
      total,
      done,
      updated_at,
    });
  }

  const now = Math.floor(Date.now() / 1000);
  replaceListTextWithHistory(row.id, row.text, text, now);
  broadcast(row.ulid, text);
  broadcastListUpdated({ ...row, text, updated_at: now });

  const { total, done } = countTodos(text);
  return json({
    name: row.name,
    slug: row.slug,
    ulid: row.ulid,
    text,
    total,
    done,
    updated_at: now,
  });
}

function postListDocHistory(
  listSlug: string,
  userId: number,
  apply: typeof applyUndo,
): Response {
  const db = getDb();
  const row = db
    .query(
      "SELECT id, user_id, ulid, name, slug, position, text, updated_at, created_at FROM lists WHERE user_id = ? AND slug = ?",
    )
    .get(userId, listSlug) as ListRow | undefined;

  if (!row) return json({ error: "not_found", reason: "list" }, 404);

  const step = runDocHistoryMutation(row, apply);
  if (!step.ok) return step.response;

  const { total, done } = countTodos(step.newText);
  return json({
    name: step.row.name,
    slug: step.row.slug,
    ulid: step.row.ulid,
    text: step.newText,
    total,
    done,
    updated_at: step.now,
  });
}

/** POST /:slug/undo — document history (same stacks as webhook; no write charge). */
export function postListUndo(listSlug: string, userId: number): Response {
  return postListDocHistory(listSlug, userId, applyUndo);
}

/** POST /:slug/redo */
export function postListRedo(listSlug: string, userId: number): Response {
  return postListDocHistory(listSlug, userId, applyRedo);
}
