import { chargeListCreate } from "../../lib/billing.js";
import { getDb } from "../../lib/db.js";
import {
  applyRedo,
  applyUndo,
  countListsForUser,
  MAX_LISTS_PER_USER,
  replaceListTextWithHistory,
} from "../../lib/listHistory.js";
import { isSelfHosted } from "../../lib/mode.js";
import {
  broadcast,
  broadcastUser,
  SSE_HEARTBEAT_MS,
  subscribeUser,
} from "../../lib/sse.js";
import {
  countTodos,
  toSlug,
  validateListName,
  validateTodosText,
} from "../../lib/todos.js";
import { ulid } from "../../lib/ulid.js";
import { json } from "../json.js";

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

export type ListsIndexPayload = {
  lists: Array<{
    name: string;
    slug: string;
    ulid: string;
    position: number;
    total: number;
    done: number;
    updated_at: number;
  }>;
};

/** Same shape as `GET /` JSON — used by index, SSE, and push notifications to clients. */
export function getListsPayload(userId: number): ListsIndexPayload {
  const db = getDb();
  const rows = db
    .query(
      "SELECT id, ulid, name, slug, position, text, created_at, updated_at FROM lists WHERE user_id = ? ORDER BY position, id",
    )
    .all(userId) as ListRow[];

  const lists = rows.map((r) => {
    const { total, done } = countTodos(r.text);
    const updated_at = r.updated_at ?? r.created_at;
    return {
      name: r.name,
      slug: r.slug,
      ulid: r.ulid,
      position: r.position,
      total,
      done,
      updated_at,
    };
  });

  return { lists };
}

/** GET / — list all lists */
export function indexLists(userId: number): Response {
  return json(getListsPayload(userId));
}

/** Broadcast updated list summaries to all SSE clients for this user (e.g. after webhook/CLI write). */
export function notifyListsChanged(userId: number): void {
  broadcastUser(userId, JSON.stringify(getListsPayload(userId)));
}

type ListRowDocHistory = Pick<
  ListRow,
  "id" | "ulid" | "user_id" | "text" | "name" | "slug"
>;

/**
 * Apply one document undo/redo step: DB mutation, SSE for list body + index.
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
  notifyListsChanged(row.user_id);
  return {
    ok: true,
    newText: result.newText,
    now: result.now,
    row,
  };
}

function formatListsSSE(listsJsonLine: string): string {
  return `event: lists\ndata: ${listsJsonLine}\n\n`;
}

/** GET /t/lists/events — authenticated SSE: `lists` events with same JSON as GET /. */
export function sseListsStream(userId: number, signal?: AbortSignal): Response {
  let unsubscribe: (() => void) | undefined;
  let onAbort: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const close = () => {
        if (heartbeat !== undefined) {
          clearInterval(heartbeat);
          heartbeat = undefined;
        }
        if (signal && onAbort) signal.removeEventListener("abort", onAbort);
        unsubscribe?.();
        unsubscribe = undefined;
        onAbort = undefined;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      unsubscribe = subscribeUser(userId, (listsJsonLine) => {
        try {
          controller.enqueue(encoder.encode(formatListsSSE(listsJsonLine)));
        } catch {
          close();
        }
      });

      try {
        controller.enqueue(
          encoder.encode(
            formatListsSSE(JSON.stringify(getListsPayload(userId))),
          ),
        );
      } catch {
        close();
        return;
      }

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode("\n: keep-alive\n\n"));
        } catch {
          close();
        }
      }, SSE_HEARTBEAT_MS);

      if (signal) {
        if (signal.aborted) {
          close();
          return;
        }
        onAbort = () => close();
        signal.addEventListener("abort", onAbort);
      }
    },
    cancel() {
      if (heartbeat !== undefined) {
        clearInterval(heartbeat);
        heartbeat = undefined;
      }
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
      unsubscribe?.();
      unsubscribe = undefined;
      onAbort = undefined;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

/** POST / — create list */
export async function createList(
  req: Request,
  userId: number,
): Promise<Response> {
  let body: { name?: string };
  try {
    body = (await req.json()) as { name?: string };
  } catch {
    return json({ error: "invalid_request", message: "Invalid JSON" }, 400);
  }

  const name = body.name?.trim();
  const nameError = validateListName(name || "");
  if (nameError)
    return json({ error: "invalid_request", message: nameError }, 400);

  const slug = toSlug(name!);
  const db = getDb();

  // Check uniqueness on slug per user
  const existing = db
    .query("SELECT 1 FROM lists WHERE user_id = ? AND slug = ?")
    .get(userId, slug);
  if (existing) {
    return json(
      {
        error: "invalid_request",
        message: `A list with URL "${slug}" already exists`,
      },
      400,
    );
  }

  if (countListsForUser(userId) >= MAX_LISTS_PER_USER) {
    return json(
      {
        error: "forbidden",
        message: "List limit reached (50 per account)",
      },
      403,
    );
  }

  // Charge for list creation
  const chargeError = await chargeListCreate(userId);
  if (chargeError) return chargeError;

  // Get next position
  const maxPos = db
    .query(
      "SELECT COALESCE(MAX(position), -1) as max_pos FROM lists WHERE user_id = ?",
    )
    .get(userId) as { max_pos: number };

  const id = ulid();
  db.run(
    "INSERT INTO lists (user_id, ulid, name, slug, position) VALUES (?, ?, ?, ?, ?)",
    userId,
    id,
    name,
    slug,
    maxPos.max_pos + 1,
  );

  notifyListsChanged(userId);

  return json(
    {
      name,
      slug,
      ulid: id,
      webhook_url: `/w/${id}`,
      position: maxPos.max_pos + 1,
    },
    201,
  );
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
      "SELECT id, ulid, name, slug, text, updated_at FROM lists WHERE user_id = ? AND slug = ?",
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
  notifyListsChanged(userId);

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
      "SELECT id, ulid, name, slug, text, updated_at, user_id FROM lists WHERE user_id = ? AND slug = ?",
    )
    .get(userId, listSlug) as ListRow | undefined;

  if (!row) return json({ error: "not_found", reason: "list" }, 404);

  const step = runDocHistoryMutation(
    {
      id: row.id,
      ulid: row.ulid,
      user_id: row.user_id,
      text: row.text,
      name: row.name,
      slug: row.slug,
    },
    apply,
  );
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

/** DELETE /:slug — delete list */
export function deleteList(listSlug: string, userId: number): Response {
  const db = getDb();
  const result = db.run(
    "DELETE FROM lists WHERE user_id = ? AND slug = ?",
    userId,
    listSlug,
  );

  if (result.changes === 0)
    return json({ error: "not_found", reason: "list" }, 404);
  notifyListsChanged(userId);
  return json({ ok: true });
}

/** PATCH /:slug — rename list */
export async function renameList(
  req: Request,
  listSlug: string,
  userId: number,
): Promise<Response> {
  let body: { name?: string };
  try {
    body = (await req.json()) as { name?: string };
  } catch {
    return json({ error: "invalid_request", message: "Invalid JSON" }, 400);
  }

  const name = body.name?.trim();
  const nameError = validateListName(name || "");
  if (nameError)
    return json({ error: "invalid_request", message: nameError }, 400);

  const newSlug = toSlug(name!);
  const db = getDb();

  const row = db
    .query("SELECT id, slug FROM lists WHERE user_id = ? AND slug = ?")
    .get(userId, listSlug) as ListRow | undefined;

  if (!row) return json({ error: "not_found", reason: "list" }, 404);

  // Check slug uniqueness if slug changed
  if (newSlug !== row.slug) {
    const existing = db
      .query("SELECT 1 FROM lists WHERE user_id = ? AND slug = ?")
      .get(userId, newSlug);
    if (existing) {
      return json(
        {
          error: "invalid_request",
          message: `A list with URL "${newSlug}" already exists`,
        },
        400,
      );
    }
  }

  db.run(
    "UPDATE lists SET name = ?, slug = ? WHERE id = ?",
    name,
    newSlug,
    row.id,
  );

  notifyListsChanged(userId);
  return json({ name, slug: newSlug, old_slug: listSlug });
}

/** PATCH /t/reorder — reorder lists */
export async function reorderLists(
  req: Request,
  userId: number,
): Promise<Response> {
  let body: { order?: string[] };
  try {
    body = (await req.json()) as { order?: string[] };
  } catch {
    return json({ error: "invalid_request", message: "Invalid JSON" }, 400);
  }

  if (!Array.isArray(body.order)) {
    return json(
      {
        error: "invalid_request",
        message: "order must be an array of list slugs",
      },
      400,
    );
  }

  const db = getDb();
  const stmt = db.prepare(
    "UPDATE lists SET position = ? WHERE user_id = ? AND slug = ?",
  );

  for (let i = 0; i < body.order.length; i++) {
    stmt.run(i, userId, body.order[i]);
  }

  notifyListsChanged(userId);
  return json({ ok: true });
}
