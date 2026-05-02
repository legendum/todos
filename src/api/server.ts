import { join, resolve } from "node:path";
import { setAuthCookieHeader } from "../lib/auth.js";
import { closeTabs } from "../lib/billing.js";
import { getDb } from "../lib/db.js";
import { isSelfHosted, LOCAL_USER_EMAIL } from "../lib/mode.js";
import { seedDefaultListsForNewUser } from "../lib/seed-default-lists.js";
import { requireAuthAsync } from "./auth-middleware.js";
import { json } from "./json.js";

const root = resolve(import.meta.dir, "../..");

import * as authHandlers from "./handlers/auth.js";
import * as listHandlers from "./handlers/lists.js";
import * as settingsHandlers from "./handlers/settings.js";
import * as webhookHandlers from "./handlers/webhook.js";

// @ts-expect-error — pure JS SDK
const legendumSdk = require("../lib/legendum.js");

// Initialize DB
getDb();

import { PORT } from "../lib/constants.js";

// Legendum middleware for link/unlink
const legendumMiddleware = legendumSdk.isConfigured()
  ? legendumSdk.middleware({
      prefix: "/t/legendum",
      getToken: async (_req: Request, userId: string) => {
        const db = getDb();
        const row = db
          .query("SELECT legendum_token FROM users WHERE id = ?")
          .get(userId) as { legendum_token: string | null } | undefined;
        return row?.legendum_token || null;
      },
      setToken: async (_req: Request, accountToken: string, userId: string) => {
        const db = getDb();
        db.run(
          "UPDATE users SET legendum_token = ? WHERE id = ?",
          accountToken,
          userId,
        );
      },
      clearToken: async (_req: Request, userId: string) => {
        const db = getDb();
        db.run("UPDATE users SET legendum_token = NULL WHERE id = ?", userId);
      },
      onLinkKey: async (
        _req: Request,
        accountToken: string,
        email: string | null,
      ) => {
        if (!email) return;
        const db = getDb();
        let row = db.query("SELECT id FROM users WHERE email = ?").get(email) as
          | { id: number }
          | undefined;
        if (!row) {
          db.run(
            "INSERT INTO users (email, legendum_token) VALUES (?, ?)",
            email,
            accountToken,
          );
          row = db.query("SELECT id FROM users WHERE email = ?").get(email) as {
            id: number;
          };
          seedDefaultListsForNewUser(row.id);
        } else {
          db.run(
            "UPDATE users SET legendum_token = ? WHERE id = ?",
            accountToken,
            row.id,
          );
        }
      },
    })
  : null;

// CORS is needed only on the public webhook surface (`/w/:ulid` and friends),
// which third-party agents and scripts hit cross-origin. The PWA frontend is
// same-origin and chats2me hits us server-to-server, so neither needs CORS.
// Webhook routes do not authenticate via Authorization (the ULID in the URL
// is the credential), so Authorization is intentionally absent here.
const webhookCorsHeaders: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function addWebhookCors(res: Response): Response {
  const r = new Response(res.body, {
    status: res.status,
    headers: res.headers,
  });
  for (const [k, v] of Object.entries(webhookCorsHeaders)) r.headers.set(k, v);
  return r;
}

const LIST_SLUG = "[a-zA-Z0-9][a-zA-Z0-9._-]*";

/**
 * `/slug`, `/slug.md`, or `/slug.json`. Two patterns are required: if `.` is
 * allowed inside the slug, a single alternation would let `groceries.json`
 * match as slug `groceries.json` with no extension (PUT would 404).
 */
function matchListPath(path: string): {
  slug: string;
  ext?: "md" | "json";
} | null {
  const withExt = path.match(new RegExp(`^\\/(${LIST_SLUG})\\.(md|json)$`));
  if (withExt) {
    return { slug: withExt[1], ext: withExt[2] as "md" | "json" };
  }
  const plain = path.match(new RegExp(`^\\/(${LIST_SLUG})$`));
  if (plain) return { slug: plain[1] };
  return null;
}

/** `POST /:slug/undo` or `POST /:slug/redo` — match before generic list routes. */
function matchListDocHistory(
  path: string,
  method: string,
): { slug: string; kind: "undo" | "redo" } | null {
  if (method !== "POST") return null;
  const undo = path.match(new RegExp(`^\\/(${LIST_SLUG})\\/undo$`));
  if (undo) return { slug: undo[1], kind: "undo" };
  const redo = path.match(new RegExp(`^\\/(${LIST_SLUG})\\/redo$`));
  if (redo) return { slug: redo[1], kind: "redo" };
  return null;
}

/** Find the built JS bundle filename (content-hashed). */
let bundleFile: string | null = null;
async function getBundleFilename(): Promise<string | null> {
  if (bundleFile) return bundleFile;
  try {
    const glob = new Bun.Glob("entry-*.js");
    for await (const file of glob.scan(join(root, "public/dist"))) {
      bundleFile = file;
      return file;
    }
  } catch {}
  return null;
}

/** Webhook OPTIONS preflight — shared across all `/w/:ulid` routes. */
function webhookCorsPreflight(): Response {
  return new Response(null, { status: 204, headers: webhookCorsHeaders });
}

/** Serve a file from disk; 404 if missing. */
async function serveStatic(
  filePath: string,
  contentType: string,
  cacheControl?: string,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return new Response("Not found", { status: 404 });
  }
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    ...(cacheControl ? { "Cache-Control": cacheControl } : {}),
    ...(extraHeaders ?? {}),
  };
  return new Response(file, { headers });
}

async function serveIndex(): Promise<Response> {
  const bundle = await getBundleFilename();
  const scriptTag = bundle
    ? `<script type="module" src="/dist/${bundle}"></script>`
    : "";
  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <meta name="theme-color" content="#0f172a" />
    <title>Todos</title>
    <link rel="icon" type="image/png" sizes="192x192" href="/todos-192.png" />
    <link rel="icon" type="image/png" sizes="512x512" href="/todos-512.png" />
    <link rel="apple-touch-icon" href="/todos-192.png" />
    <link rel="manifest" href="/manifest.json" />
    <link rel="stylesheet" href="/main.css" />
  </head>
  <body>
    <div id="root"></div>
    ${scriptTag}
  </body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html" } });
}

export default {
  port: PORT,
  development: !!process.env.DEV,
  routes: {
    // --- Auth (only mounted in hosted mode; top-level browser nav, no CORS) ---
    ...(legendumSdk.isConfigured()
      ? {
          "/auth/login": {
            GET: (req: Request) => authHandlers.getLogin(req),
          },
          "/auth/callback": {
            GET: (req: Request) => authHandlers.getCallback(req),
          },
          "/auth/logout": {
            POST: () => authHandlers.postLogout(),
          },
        }
      : {}),

    // --- Public webhook (cross-origin: CORS applied) ---
    "/w/:ulid": {
      OPTIONS: webhookCorsPreflight,
      GET: (req: { params: { ulid: string } }) =>
        addWebhookCors(webhookHandlers.getWebhookTodos(req.params.ulid)),
      PUT: async (req: Request & { params: { ulid: string } }) =>
        addWebhookCors(
          await webhookHandlers.replaceWebhookTodos(req, req.params.ulid),
        ),
      POST: async (req: Request & { params: { ulid: string } }) =>
        addWebhookCors(
          await webhookHandlers.replaceWebhookTodos(req, req.params.ulid),
        ),
    },
    "/w/:ulid/undo": {
      OPTIONS: webhookCorsPreflight,
      POST: (req: { params: { ulid: string } }) =>
        addWebhookCors(webhookHandlers.postWebhookUndo(req.params.ulid)),
    },
    "/w/:ulid/redo": {
      OPTIONS: webhookCorsPreflight,
      POST: (req: { params: { ulid: string } }) =>
        addWebhookCors(webhookHandlers.postWebhookRedo(req.params.ulid)),
    },
    "/w/:ulid/events": {
      OPTIONS: webhookCorsPreflight,
      GET: (req: Request & { params: { ulid: string } }) =>
        addWebhookCors(webhookHandlers.sseStream(req.params.ulid, req.signal)),
    },

    // --- Static assets (same-origin, no CORS) ---
    "/main.css": () => serveStatic(join(root, "src/web/main.css"), "text/css"),
    "/manifest.json": () =>
      serveStatic(
        join(root, "src/web/manifest.json"),
        "application/manifest+json",
      ),
    "/todos.png": () =>
      serveStatic(join(root, "public/todos.png"), "image/png"),
    "/todos-192.png": () =>
      serveStatic(join(root, "public/todos-192.png"), "image/png"),
    "/todos-512.png": () =>
      serveStatic(join(root, "public/todos-512.png"), "image/png"),
    "/undo-arrow.svg": () =>
      serveStatic(
        join(root, "public/undo-arrow.svg"),
        "image/svg+xml",
        "public, max-age=86400",
      ),
    "/redo-arrow.svg": () =>
      serveStatic(
        join(root, "public/redo-arrow.svg"),
        "image/svg+xml",
        "public, max-age=86400",
      ),
    "/dist/sw.js": () =>
      serveStatic(
        join(root, "public/dist/sw.js"),
        "application/javascript",
        "no-cache",
        { "Service-Worker-Allowed": "/" },
      ),
  },
  async fetch(req: Request) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // OPTIONS preflight for any webhook path not explicitly registered above
    // (also covers any future webhook routes that fall through to fetch).
    if (method === "OPTIONS" && path.startsWith("/w/")) {
      return new Response(null, { status: 204, headers: webhookCorsHeaders });
    }

    // --- Workbox + hashed dist bundles (pattern-matched, kept in fetch) ---
    if (/^\/dist\/workbox-[a-f0-9]+\.js(\.map)?$/.test(path)) {
      const file = Bun.file(join(root, "public", path.slice(1)));
      if (await file.exists()) {
        const isMap = path.endsWith(".map");
        return new Response(file, {
          headers: {
            "Content-Type": isMap
              ? "application/json"
              : "application/javascript",
            "Cache-Control": isMap ? "no-cache" : "public, max-age=86400",
          },
        });
      }
    }
    if (path.startsWith("/dist/")) {
      const file = Bun.file(join(root, "public", path));
      if (await file.exists()) {
        return new Response(file, {
          headers: {
            "Content-Type": "application/javascript",
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      }
    }

    // Browser GETs to non-API paths get the SPA shell. Runs before user
    // resolution so unauthenticated visitors land on the login UI in hosted mode.
    const accept = req.headers.get("Accept") ?? "";
    const isPageNavigation =
      method === "GET" &&
      !accept.includes("application/json") &&
      !path.startsWith("/t/") &&
      !path.startsWith("/w/") &&
      !path.startsWith("/dist/") &&
      !path.match(/\.(md|json)$/);

    if (isPageNavigation) {
      return await serveIndex();
    }

    // POST link-key: Bearer lak_ → account_token + optional session cookie.
    // Hosted-mode-only and must run before requireAuth.
    if (
      legendumMiddleware &&
      path === "/t/legendum/link-key" &&
      method === "POST"
    ) {
      const legendumRes = await legendumMiddleware(req);
      if (legendumRes?.status === 200) {
        const data = (await legendumRes.json()) as {
          account_token: string;
          email?: string;
        };
        const email = data.email;
        if (email) {
          const db = getDb();
          const row = db
            .query("SELECT id FROM users WHERE email = ?")
            .get(email) as { id: number } | undefined;
          if (row) {
            const headers = new Headers({
              "Content-Type": "application/json",
            });
            headers.append("Set-Cookie", setAuthCookieHeader(row.id));
            return new Response(JSON.stringify(data), { status: 200, headers });
          }
        }
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return legendumRes!;
    }

    // Resolve the user. Self-hosted: ensure a single local user exists.
    // Hosted: require a session cookie or Bearer account_token.
    let userId: number;
    if (isSelfHosted()) {
      const db = getDb();
      let user = db.query("SELECT id FROM users LIMIT 1").get() as {
        id: number;
      } | null;
      if (!user) {
        db.run("INSERT INTO users (email) VALUES (?)", LOCAL_USER_EMAIL);
        user = db.query("SELECT id FROM users LIMIT 1").get() as { id: number };
        seedDefaultListsForNewUser(user.id);
      }
      userId = user.id;
    } else {
      const auth = await requireAuthAsync(req);
      if (auth instanceof Response) return auth;
      userId = auth.userId;

      if (legendumMiddleware) {
        const legendumRes = await legendumMiddleware(req, userId);
        if (legendumRes) return legendumRes;
      }
    }

    // --- Unified routes (both modes; same-origin / server-to-server, no CORS) ---
    if (path === "/" && method === "GET") {
      return listHandlers.indexLists(userId);
    }
    if (path === "/" && method === "POST") {
      return await listHandlers.createList(req, userId);
    }
    if (path === "/t/reorder" && method === "PATCH") {
      return await listHandlers.reorderLists(req, userId);
    }
    if (path === "/t/settings/me" && method === "GET") {
      return settingsHandlers.getMe(userId);
    }
    if (path === "/t/lists/events" && method === "GET") {
      return listHandlers.sseListsStream(userId, req.signal);
    }

    const docHist = matchListDocHistory(path, method);
    if (docHist) {
      return docHist.kind === "undo"
        ? listHandlers.postListUndo(docHist.slug, userId)
        : listHandlers.postListRedo(docHist.slug, userId);
    }

    const listParsed = matchListPath(path);
    if (
      listParsed &&
      !path.startsWith("/t/") &&
      !path.startsWith("/w/") &&
      !path.startsWith("/dist/")
    ) {
      const { slug, ext } = listParsed;

      if (method === "GET") {
        const result = listHandlers.getTodos(
          req,
          ext ? `${slug}.${ext}` : slug,
          userId,
        );
        if (result === null) return await serveIndex();
        return result;
      }
      if (method === "PUT" || method === "POST") {
        return await listHandlers.replaceTodos(req, slug, userId);
      }
      if (method === "PATCH") {
        return await listHandlers.renameList(req, slug, userId);
      }
      if (method === "DELETE") {
        return listHandlers.deleteList(slug, userId);
      }
    }

    // Self-hosted historically served the SPA for any unmatched route;
    // preserve that to avoid surprising existing clients.
    if (isSelfHosted()) return await serveIndex();
    return json({ error: "not_found", reason: "route" }, 404);
  },
};

// Graceful shutdown
process.on("SIGTERM", async () => {
  await closeTabs();
  process.exit(0);
});
process.on("SIGINT", async () => {
  await closeTabs();
  process.exit(0);
});
