import { chargeCategoryCreate } from "../../lib/billing.js";
import { getDb } from "../../lib/db.js";
import { isSelfHosted } from "../../lib/mode.js";
import { broadcast } from "../../lib/sse.js";
import {
  countTodos,
  toSlug,
  validateCategoryName,
  validateTodosText,
} from "../../lib/todos.js";
import { ulid } from "../../lib/ulid.js";
import { json } from "../json.js";

type CategoryRow = {
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

/** GET / — list all categories */
export function listCategories(userId: number): Response {
  const db = getDb();
  const rows = db
    .query(
      "SELECT id, ulid, name, slug, position, text, created_at, updated_at FROM categories WHERE user_id = ? ORDER BY position, id",
    )
    .all(userId) as CategoryRow[];

  const categories = rows.map((r) => {
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

  return json({ categories });
}

/** POST / — create category */
export async function createCategory(
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
  const nameError = validateCategoryName(name || "");
  if (nameError)
    return json({ error: "invalid_request", message: nameError }, 400);

  const slug = toSlug(name!);
  const db = getDb();

  // Check uniqueness on slug per user
  const existing = db
    .query("SELECT 1 FROM categories WHERE user_id = ? AND slug = ?")
    .get(userId, slug);
  if (existing) {
    return json(
      {
        error: "invalid_request",
        message: `A category with URL "${slug}" already exists`,
      },
      400,
    );
  }

  // Charge for category creation
  const chargeError = await chargeCategoryCreate(userId);
  if (chargeError) return chargeError;

  // Get next position
  const maxPos = db
    .query(
      "SELECT COALESCE(MAX(position), -1) as max_pos FROM categories WHERE user_id = ?",
    )
    .get(userId) as { max_pos: number };

  const id = ulid();
  db.run(
    "INSERT INTO categories (user_id, ulid, name, slug, position) VALUES (?, ?, ?, ?, ?)",
    userId,
    id,
    name,
    slug,
    maxPos.max_pos + 1,
  );

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

/** GET /:slug — get todos (supports content negotiation) */
export function getTodos(
  req: Request,
  categorySlug: string,
  userId: number,
): Response {
  const db = getDb();

  // Strip extension for content negotiation
  let format = "html";
  let slug = categorySlug;
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
      "SELECT ulid, name, slug, text, position, updated_at, created_at FROM categories WHERE user_id = ? AND slug = ?",
    )
    .get(userId, slug) as CategoryRow | undefined;

  if (!row) return json({ error: "not_found" }, 404);

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
  return null as any;
}

/** PUT or POST /:slug — replace all todos */
export async function replaceTodos(
  req: Request,
  categorySlug: string,
  userId: number,
): Promise<Response> {
  const db = getDb();
  const row = db
    .query(
      "SELECT id, ulid, name, slug, text FROM categories WHERE user_id = ? AND slug = ?",
    )
    .get(userId, categorySlug) as CategoryRow | undefined;

  if (!row) return json({ error: "not_found" }, 404);

  const text = await req.text();
  const validationError = validateTodosText(text, isSelfHosted());
  if (validationError) {
    return json({ error: "invalid_request", message: validationError }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  db.run(
    "UPDATE categories SET text = ?, updated_at = ? WHERE id = ?",
    text,
    now,
    row.id,
  );
  broadcast(row.ulid, text);

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

/** DELETE /:slug — delete category */
export function deleteCategory(categorySlug: string, userId: number): Response {
  const db = getDb();
  const result = db.run(
    "DELETE FROM categories WHERE user_id = ? AND slug = ?",
    userId,
    categorySlug,
  );

  if (result.changes === 0) return json({ error: "not_found" }, 404);
  return json({ ok: true });
}

/** PATCH /:slug — rename category */
export async function renameCategory(
  req: Request,
  categorySlug: string,
  userId: number,
): Promise<Response> {
  let body: { name?: string };
  try {
    body = (await req.json()) as { name?: string };
  } catch {
    return json({ error: "invalid_request", message: "Invalid JSON" }, 400);
  }

  const name = body.name?.trim();
  const nameError = validateCategoryName(name || "");
  if (nameError)
    return json({ error: "invalid_request", message: nameError }, 400);

  const newSlug = toSlug(name!);
  const db = getDb();

  const row = db
    .query("SELECT id, slug FROM categories WHERE user_id = ? AND slug = ?")
    .get(userId, categorySlug) as CategoryRow | undefined;

  if (!row) return json({ error: "not_found" }, 404);

  // Check slug uniqueness if slug changed
  if (newSlug !== row.slug) {
    const existing = db
      .query("SELECT 1 FROM categories WHERE user_id = ? AND slug = ?")
      .get(userId, newSlug);
    if (existing) {
      return json(
        {
          error: "invalid_request",
          message: `A category with URL "${newSlug}" already exists`,
        },
        400,
      );
    }
  }

  db.run(
    "UPDATE categories SET name = ?, slug = ? WHERE id = ?",
    name,
    newSlug,
    row.id,
  );

  return json({ name, slug: newSlug, old_slug: categorySlug });
}

/** PATCH /t/reorder — reorder categories */
export async function reorderCategories(
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
        message: "order must be an array of category slugs",
      },
      400,
    );
  }

  const db = getDb();
  const stmt = db.prepare(
    "UPDATE categories SET position = ? WHERE user_id = ? AND slug = ?",
  );

  for (let i = 0; i < body.order.length; i++) {
    stmt.run(i, userId, body.order[i]);
  }

  return json({ ok: true });
}
