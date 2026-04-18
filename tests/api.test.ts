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
    port: PORT,
    fetch: mod.default.fetch,
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

describe("API — self-hosted mode", () => {
  test("GET /t/settings/me returns local user", async () => {
    const { status, body } = await jsonGet("/t/settings/me");
    expect(status).toBe(200);
    expect(body.legendum_linked).toBe(false);
  });

  test("POST / creates a category", async () => {
    const { status, body } = await jsonPost("/", { name: "groceries" });
    expect(status).toBe(201);
    expect(body.name).toBe("groceries");
    expect(body.slug).toBe("groceries");
    expect(body.ulid).toBeTruthy();
    expect(body.webhook_url).toStartWith("/w/");
  });

  test("POST / creates a category with spaces", async () => {
    const { status, body } = await jsonPost("/", { name: "My Shopping List" });
    expect(status).toBe(201);
    expect(body.name).toBe("My Shopping List");
    expect(body.slug).toBe("my-shopping-list");
  });

  test("POST / rejects duplicate slug", async () => {
    // "my-shopping-list" already exists from the spaces test
    const { status } = await jsonPost("/", { name: "my shopping list" });
    expect(status).toBe(400);
  });

  test("POST / rejects duplicate category", async () => {
    const { status } = await jsonPost("/", { name: "groceries" });
    expect(status).toBe(400);
  });

  test("POST / rejects reserved names", async () => {
    const { status, body } = await jsonPost("/", { name: "t" });
    expect(status).toBe(400);
    expect(body.message).toContain("reserved");
  });

  test("GET / lists categories", async () => {
    const { status, body } = await jsonGet("/");
    expect(status).toBe(200);
    expect(body.categories.length).toBe(2);
    expect(body.categories[0].name).toBe("groceries");
    expect(body.categories[0].slug).toBe("groceries");
    expect(typeof body.categories[0].updated_at).toBe("number");
    expect(body.categories[1].slug).toBe("my-shopping-list");
  });

  test("GET / list updated_at does not go backwards after PUT", async () => {
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
    const { body } = await jsonGet("/");
    const groceries = body.categories.find(
      (c: { slug: string }) => c.slug === "groceries",
    );
    expect(groceries.updated_at).toBeGreaterThanOrEqual(t0);
  });

  test("GET /:slug works for category with spaces in name", async () => {
    const res = await fetch(`${base}/my-shopping-list.json`, {
      headers: { Accept: "application/json" },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("My Shopping List");
    expect(data.slug).toBe("my-shopping-list");
  });

  test("DELETE category with slug", async () => {
    const res = await fetch(`${base}/my-shopping-list`, { method: "DELETE" });
    expect(res.status).toBe(200);
  });

  test("PUT /:category replaces todos", async () => {
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

  test("PUT /:category.json is the same route as PUT /:category (slug excludes extension)", async () => {
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

  test("PUT /:category accepts JSON { markdown }", async () => {
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

  test("PUT /:category accepts JSON { text } alias", async () => {
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

  test("PUT /:category JSON without markdown or text returns 400", async () => {
    const res = await fetch(`${base}/groceries`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("invalid_request");
  });

  test("GET /:category.md returns markdown", async () => {
    const res = await fetch(`${base}/groceries.md`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("[ ] Milk");
    expect(text).toContain("[x] Bread");
    expect(text).toContain("## Shopping");
  });

  test("GET /:category.json returns JSON", async () => {
    const { status, body } = await jsonGet("/groceries.json");
    expect(status).toBe(200);
    expect(body.name).toBe("groceries");
    expect(body.total).toBe(3);
    expect(body.text).toContain("[ ] Milk");
  });

  test("POST /:category also replaces (same as PUT)", async () => {
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
    const { body } = await jsonGet("/");
    const ulid = body.categories[0].ulid;

    const res = await fetch(`${base}/w/${ulid}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Category-Slug")).toBe("groceries");
    expect(res.headers.get("X-Category-Name")).toBe("groceries");
    const text = await res.text();
    expect(text).toContain("[ ] Only todo");
  });

  test("webhook PUT replaces todos", async () => {
    const { body } = await jsonGet("/");
    const ulid = body.categories[0].ulid;

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
    const { body } = await jsonGet("/");
    const ulid = body.categories[0].ulid;

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

  test("PATCH /t/reorder reorders categories", async () => {
    // Create another category
    await jsonPost("/", { name: "work" });

    const res = await fetch(`${base}/t/reorder`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: ["work", "groceries"] }),
    });
    expect(res.status).toBe(200);

    const { body } = await jsonGet("/");
    expect(body.categories[0].name).toBe("work");
    expect(body.categories[1].name).toBe("groceries");
  });

  test("DELETE /:category deletes a category", async () => {
    const res = await fetch(`${base}/work`, { method: "DELETE" });
    expect(res.status).toBe(200);

    const { body } = await jsonGet("/");
    expect(body.categories.length).toBe(1);
    expect(body.categories[0].name).toBe("groceries");
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
    const { body } = await jsonGet("/");
    const ulid = body.categories[0].ulid;

    const res = await fetch(`${base}/w/${ulid}/events`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
  });

  test("markdown task list syntax supported by parser and countTodos", async () => {
    const create = await jsonPost("/", { name: "markdown-test" });
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

    await fetch(`${base}/markdown-test`, { method: "DELETE" });
  });
});
