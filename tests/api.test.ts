import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const TEST_DB_PATH = "data/test-todos.db";
const PORT = 3031;
let server: any;

beforeAll(async () => {
  // Set up test environment — force self-hosted mode
  process.env.TODOS_DB_PATH = TEST_DB_PATH;
  delete process.env.LEGENDUM_API_KEY;
  delete process.env.LEGENDUM_SECRET;

  // Ensure data directory exists
  mkdirSync("data", { recursive: true });

  // Clean up old test db
  if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);

  // Import and start server
  const mod = await import("../src/api/server");
  server = Bun.serve({
    ...mod.default,
    port: PORT,
  });
});

afterAll(() => {
  server?.stop();
  if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
});

const base = `http://localhost:${PORT}`;

async function jsonGet(path: string) {
  const res = await fetch(`${base}${path}`, {
    headers: { Accept: "application/json" },
  });
  return { status: res.status, body: await res.json() };
}

async function jsonPost(path: string, body: any) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function textPut(path: string, body: string) {
  const res = await fetch(`${base}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "text/markdown" },
    body,
  });
  return { status: res.status, body: await res.text(), json: () => res.json() };
}

/** Create a list via pues' POST /api/lists; returns { status, body } where
 *  body is the canonical wire row on success or { error, message } on failure. */
async function createList(label: string) {
  return await jsonPost("/api/lists", { label });
}

/** Find a list's pues `id` (= ulid) by its `slug` passthrough. */
async function findUlidBySlug(slug: string): Promise<string> {
  const { body } = await jsonGet("/api/lists");
  const row = (body as Array<{ id: string; slug: string }>).find(
    (r) => r.slug === slug,
  );
  if (!row) throw new Error(`list not found by slug: ${slug}`);
  return row.id;
}

/** Delete a list via pues' DELETE /api/lists/:ulid given the slug. */
async function deleteListBySlug(slug: string): Promise<number> {
  const ulid = await findUlidBySlug(slug);
  const res = await fetch(`${base}/api/lists/${ulid}`, { method: "DELETE" });
  return res.status;
}

describe("API — self-hosted mode", () => {
  test("GET /pues/me returns local user after bootstrap", async () => {
    // In self-hosted mode the SPA shell mints a `pues_session` cookie via
    // `ensureLocalUser` on first page navigation; subsequent fetches
    // authenticate via that cookie. Simulate that by hitting `/` first.
    const home = await fetch(`${base}/`, { headers: { Accept: "text/html" } });
    const setCookie = home.headers.get("set-cookie") ?? "";
    const sessionMatch = setCookie.match(/pues_session=([^;]+)/);
    expect(sessionMatch).not.toBeNull();
    const cookie = `pues_session=${sessionMatch![1]}`;

    const res = await fetch(`${base}/pues/me`, {
      headers: { Accept: "application/json", Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { legendum_linked: boolean };
    expect(body.legendum_linked).toBe(false);
  });

  test("POST /api/lists creates a list", async () => {
    const { status, body } = await createList("groceries");
    expect(status).toBe(201);
    expect(body.label).toBe("groceries");
    expect(body.slug).toBe("groceries");
    expect(typeof body.id).toBe("string");
  });

  test("POST /api/lists creates a list with spaces (slug derived in beforeInsert)", async () => {
    const { status, body } = await createList("My Shopping List");
    expect(status).toBe(201);
    expect(body.label).toBe("My Shopping List");
    expect(body.slug).toBe("my-shopping-list");
  });

  test("POST /api/lists rejects duplicate slug", async () => {
    // "my-shopping-list" already exists from the spaces test
    const { status } = await createList("my shopping list");
    expect(status).toBe(400);
  });

  test("POST /api/lists rejects duplicate list", async () => {
    const { status } = await createList("groceries");
    expect(status).toBe(400);
  });

  test("POST /api/lists rejects reserved names", async () => {
    const { status, body } = await createList("t");
    expect(status).toBe(400);
    expect(body.message).toContain("reserved");
  });

  test("GET /api/lists returns canonical wire shape (pues role-mapping)", async () => {
    const { status, body } = await jsonGet("/api/lists");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(4);

    // Canonical keys: id (from public_id role = ulid), label (from `name`), position
    for (const row of body) {
      expect(typeof row.id).toBe("string");           // ulid value under `id`
      expect(typeof row.label).toBe("string");        // `name` column aliased
      expect(typeof row.position).toBe("number");
      expect(typeof row.updated_at).toBe("number");
      // Passthroughs from todos' schema
      expect(typeof row.slug).toBe("string");
      expect(typeof row.text).toBe("string");
      // Owner column must never leak to the wire
      expect(row.user_id).toBeUndefined();
      // Internal pk must never leak under that name
      expect(row.pk_value).toBeUndefined();
    }

    // Ordering: position ASC
    for (let i = 1; i < body.length; i++) {
      expect(body[i].position).toBeGreaterThanOrEqual(body[i - 1].position);
    }
  });

  test("/api/lists updated_at does not go backwards after PUT /:slug text change", async () => {
    const j0 = await fetch(`${base}/groceries.json`, {
      headers: { Accept: "application/json" },
    }).then((r) => r.json() as Promise<{ updated_at: number }>);
    const t0 = j0.updated_at;
    const put = await fetch(`${base}/groceries`, {
      method: "PUT",
      headers: { "Content-Type": "text/markdown" },
      body: "[ ] sync check",
    });
    expect(put.status).toBe(200);
    const { body } = await jsonGet("/api/lists");
    const groceries = (body as Array<{ slug: string; updated_at: number }>).find(
      (c) => c.slug === "groceries",
    );
    expect(groceries).toBeDefined();
    expect(groceries!.updated_at).toBeGreaterThanOrEqual(t0);
  });

  test("GET /:slug works for list with spaces in name", async () => {
    const res = await fetch(`${base}/my-shopping-list.json`, {
      headers: { Accept: "application/json" },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("My Shopping List");
    expect(data.slug).toBe("my-shopping-list");
  });

  test("DELETE /api/lists/:ulid removes a list", async () => {
    const status = await deleteListBySlug("my-shopping-list");
    expect(status).toBe(204);
  });

  test("PUT /:list replaces todos", async () => {
    const text = "## Shopping\n[ ] Milk\n[x] Bread\n[ ] Eggs";
    const res = await fetch(`${base}/groceries`, {
      method: "PUT",
      headers: { "Content-Type": "text/markdown" },
      body: text,
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(3);
    expect(data.done).toBe(1);
  });

  test("PUT /:list.json is the same route as PUT /:list (slug excludes extension)", async () => {
    const text = "[ ] Via dot-json path\n[x] Done";
    const res = await fetch(`${base}/groceries.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown: text }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(2);
    await fetch(`${base}/groceries`, {
      method: "PUT",
      headers: { "Content-Type": "text/markdown" },
      body: "## Shopping\n[ ] Milk\n[x] Bread\n[ ] Eggs",
    });
  });

  test("PUT /:list accepts JSON { markdown }", async () => {
    const text = "[ ] JSON body todo\n[x] Done via JSON";
    const res = await fetch(`${base}/groceries`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown: text }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(2);
    expect(data.done).toBe(1);
    const getRes = await fetch(`${base}/groceries.md`);
    const body = await getRes.text();
    expect(body).toContain("JSON body todo");
    // Restore state for following tests (same as "PUT replaces todos" fixture)
    await fetch(`${base}/groceries`, {
      method: "PUT",
      headers: { "Content-Type": "text/markdown" },
      body: "## Shopping\n[ ] Milk\n[x] Bread\n[ ] Eggs",
    });
  });

  test("PUT /:list accepts JSON { text } alias", async () => {
    const text = "[ ] Via text key\n[x] Done";
    const res = await fetch(`${base}/groceries`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(2);
    await fetch(`${base}/groceries`, {
      method: "PUT",
      headers: { "Content-Type": "text/markdown" },
      body: "## Shopping\n[ ] Milk\n[x] Bread\n[ ] Eggs",
    });
  });

  test("PUT /:list JSON without markdown or text returns 400", async () => {
    const res = await fetch(`${base}/groceries`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("invalid_request");
  });

  test("GET /:list.md returns markdown", async () => {
    const res = await fetch(`${base}/groceries.md`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("[ ] Milk");
    expect(text).toContain("[x] Bread");
    expect(text).toContain("## Shopping");
  });

  test("GET /:list.json returns JSON", async () => {
    const { status, body } = await jsonGet("/groceries.json");
    expect(status).toBe(200);
    expect(body.name).toBe("groceries");
    expect(body.total).toBe(3);
    expect(body.text).toContain("[ ] Milk");
  });

  test("POST /:list also replaces (same as PUT)", async () => {
    const text = "[ ] Only todo";
    const res = await fetch(`${base}/groceries`, {
      method: "POST",
      headers: { "Content-Type": "text/markdown" },
      body: text,
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(1);
  });

  test("webhook GET returns todos", async () => {
    // Get ulid
    const ulid = await findUlidBySlug("groceries");

    const res = await fetch(`${base}/w/${ulid}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-List-Slug")).toBe("groceries");
    expect(res.headers.get("X-List-Name")).toBe("groceries");
    const text = await res.text();
    expect(text).toContain("[ ] Only todo");
  });

  test("webhook PUT replaces todos", async () => {
    const ulid = await findUlidBySlug("groceries");

    const res = await fetch(`${base}/w/${ulid}`, {
      method: "PUT",
      headers: { "Content-Type": "text/markdown" },
      body: "[ ] Webhook todo\n[x] Webhook done",
    });
    expect(res.status).toBe(200);

    const getRes = await fetch(`${base}/w/${ulid}`);
    const text = await getRes.text();
    expect(text).toContain("[ ] Webhook todo");
    expect(text).toContain("[x] Webhook done");
  });

  test("webhook POST also replaces (same as PUT)", async () => {
    const ulid = await findUlidBySlug("groceries");

    const res = await fetch(`${base}/w/${ulid}`, {
      method: "POST",
      headers: { "Content-Type": "text/markdown" },
      body: "[ ] Via POST",
    });
    expect(res.status).toBe(200);

    const getRes = await fetch(`${base}/w/${ulid}`);
    const text = await getRes.text();
    expect(text).toBe("[ ] Via POST");
  });

  test("webhook 404 for unknown ulid", async () => {
    const res = await fetch(`${base}/w/AAAABBBBCCCCDDDDEEEE`);
    expect(res.status).toBe(404);
  });

  test("PATCH /api/lists/:ulid reorders via {after}", async () => {
    await createList("work");

    // Initial order: today, ideas, groceries, work — move work to the top
    // by placing it before today.
    const workUlid = await findUlidBySlug("work");
    const todayUlid = await findUlidBySlug("today");
    const res = await fetch(`${base}/api/lists/${workUlid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ before: todayUlid }),
    });
    expect(res.status).toBe(200);

    const { body } = await jsonGet("/api/lists");
    const labels = (body as Array<{ label: string }>).map((r) => r.label);
    expect(labels[0]).toBe("work");
    expect(labels[1]).toBe("Today");
  });

  test("DELETE /api/lists/:ulid removes the row", async () => {
    const status = await deleteListBySlug("work");
    expect(status).toBe(204);

    const { body } = await jsonGet("/api/lists");
    expect((body as unknown[]).length).toBe(3);
    const labels = (body as Array<{ label: string }>).map((r) => r.label);
    expect(labels).toContain("groceries");
    expect(labels).toContain("Today");
    expect(labels).toContain("Ideas");
  });

  test("free-form text is preserved", async () => {
    const text = `## Sprint 3
Context: we need to ship by Friday

[ ] Fix login bug
[x] Add validation

## Notes
- Talked to PM about scope
- Design review on Thursday

[ ] Write tests`;

    const res = await fetch(`${base}/groceries`, {
      method: "PUT",
      headers: { "Content-Type": "text/markdown" },
      body: text,
    });
    expect(res.status).toBe(200);

    const getRes = await fetch(`${base}/groceries.md`);
    const result = await getRes.text();
    expect(result).toBe(text);
    expect(result).toContain("## Sprint 3");
    expect(result).toContain("- Talked to PM about scope");
  });

  test("SSE endpoint returns event stream", async () => {
    const ulid = await findUlidBySlug("groceries");
    const res = await fetch(`${base}/w/${ulid}/events`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
  });

  test("PUT /:slug pushes a lists.updated event on the pues /api/events stream", async () => {
    const { status: createStatus, body: created } = await createList(
      "sse-put-notify",
    );
    expect(createStatus).toBe(201);
    const slug = (created as { slug: string }).slug;

    const ctrl = new AbortController();
    const sseRes = await fetch(`${base}/api/events`, { signal: ctrl.signal });
    expect(sseRes.status).toBe(200);
    const reader = sseRes.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";

    // Drain the initial `: connected` comment so the SSE handler's
    // `start(controller)` has registered this stream before we mutate.
    {
      const first = await reader.read();
      if (first.value) buf += dec.decode(first.value, { stream: true });
    }

    // Read with a per-poll timeout — reader.read() blocks indefinitely on an
    // open SSE stream, so a plain while-loop would never exit.
    const readChunk = async (timeoutMs: number): Promise<boolean> => {
      const r = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value?: undefined }>((res) =>
          setTimeout(() => res({ done: true }), timeoutMs),
        ),
      ]);
      if (r.done) return false;
      if (r.value) buf += dec.decode(r.value, { stream: true });
      return true;
    };

    const put = await fetch(`${base}/${slug}`, {
      method: "PUT",
      headers: { "Content-Type": "text/markdown" },
      body: "[x] one\n[ ] two\n",
    });
    expect(put.status).toBe(200);

    const deadline = Date.now() + 3000;
    while (
      !buf.includes("event: lists.updated") &&
      Date.now() < deadline
    ) {
      await readChunk(Math.max(50, deadline - Date.now()));
    }

    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
    ctrl.abort();

    expect(buf).toContain("event: lists.updated");

    const dataLine = buf
      .split("\n\n")
      .reverse()
      .map((block) => block.split("\n"))
      .find((lines) => lines.some((l) => l === "event: lists.updated"))!
      .find((l) => l.startsWith("data: "));
    expect(dataLine).toBeDefined();
    const parsed = JSON.parse(dataLine!.slice(6).trim()) as {
      id: string;
      label: string;
      text: string;
      slug: string;
      op_id: string | null;
    };
    expect(parsed.slug).toBe(slug);
    expect(parsed.text).toBe("[x] one\n[ ] two\n");
    // Server-initiated mutation (text change via bespoke PUT) carries op_id: null.
    expect(parsed.op_id).toBeNull();

    await deleteListBySlug(slug);
  });

  test("markdown task list syntax supported by parser and countTodos", async () => {
    const create = await createList("markdown-test");
    expect(create.status).toBe(201);

    const text = `## Markdown Test

- [ ] task one
* [x] task two

Note with list
- [ ] task three
[x] bare task four`;

    const putRes = await fetch(`${base}/markdown-test`, {
      method: "PUT",
      headers: { "Content-Type": "text/markdown" },
      body: text,
    });
    expect(putRes.status).toBe(200);
    const data = await putRes.json();
    expect(data.total).toBe(4);
    expect(data.done).toBe(2);

    const mdRes = await fetch(`${base}/markdown-test.md`);
    const mdText = await mdRes.text();
    expect(mdText).toBe(text);

    await deleteListBySlug("markdown-test");
  });

  test("webhook PUT snapshots then POST undo/redo round-trip", async () => {
    const ulid = await findUlidBySlug("groceries");

    const v1 = "[ ] one\n";
    const v2 = "[ ] two\n";

    let r = await fetch(`${base}/w/${ulid}`, {
      method: "PUT",
      headers: { "Content-Type": "text/markdown" },
      body: v1,
    });
    expect(r.status).toBe(200);

    r = await fetch(`${base}/w/${ulid}`, {
      method: "PUT",
      headers: { "Content-Type": "text/markdown" },
      body: v2,
    });
    expect(r.status).toBe(200);

    r = await fetch(`${base}/w/${ulid}/undo`, { method: "POST" });
    expect(r.status).toBe(200);
    expect(await r.text()).toBe(v1);

    r = await fetch(`${base}/w/${ulid}/redo`, { method: "POST" });
    expect(r.status).toBe(200);
    expect(await r.text()).toBe(v2);
  });

  test("POST /w/:ulid/undo returns 409 when stack empty", async () => {
    const create = await createList("undo-empty-test");
    expect(create.status).toBe(201);
    const u = (create.body as { id: string }).id;

    const r = await fetch(`${base}/w/${u}/undo`, { method: "POST" });
    expect(r.status).toBe(409);
    const j = (await r.json()) as { message?: string };
    expect(j.message).toBeTruthy();
  });

  test("POST /:slug/undo and /redo return JSON (session)", async () => {
    const { status, body } = await createList("slug-history-test");
    expect(status).toBe(201);
    const slug = (body as { slug: string }).slug;

    const v1 = "- [ ] one\n";
    const v2 = "- [ ] two\n";

    let put = await fetch(`${base}/${slug}`, {
      method: "PUT",
      headers: { "Content-Type": "text/markdown" },
      body: v1,
    });
    expect(put.status).toBe(200);

    put = await fetch(`${base}/${slug}`, {
      method: "PUT",
      headers: { "Content-Type": "text/markdown" },
      body: v2,
    });
    expect(put.status).toBe(200);

    let r = await fetch(`${base}/${slug}/undo`, { method: "POST" });
    expect(r.status).toBe(200);
    let j = (await r.json()) as { text: string };
    expect(j.text).toBe(v1);

    r = await fetch(`${base}/${slug}/redo`, { method: "POST" });
    expect(r.status).toBe(200);
    j = await r.json();
    expect(j.text).toBe(v2);

    await deleteListBySlug(slug);
  });

  test("POST /:slug/undo returns 409 when stack empty", async () => {
    const { status, body } = await createList("slug-undo-empty");
    expect(status).toBe(201);
    const slug = (body as { slug: string }).slug;

    const r = await fetch(`${base}/${slug}/undo`, { method: "POST" });
    expect(r.status).toBe(409);
    const j = (await r.json()) as { message?: string };
    expect(j.message).toBeTruthy();

    await deleteListBySlug(slug);
  });

  test("POST /api/lists rejects 51st list with 403", async () => {
    const { body } = await jsonGet("/api/lists");
    const start = (body as unknown[]).length;
    for (let i = start; i < 50; i++) {
      const { status } = await createList(`cap-fill-${i}`);
      expect(status).toBe(201);
    }
    const { status, body: b } = await createList("cap-overflow");
    expect(status).toBe(403);
    expect((b as { message?: string }).message).toContain("50");
  });
});
