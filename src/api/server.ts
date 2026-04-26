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

const corsHeaders: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function addCors(res: Response): Response {
  const r = new Response(res.body, {
    status: res.status,
    headers: res.headers,
  });
  for (const [k, v] of Object.entries(corsHeaders)) r.headers.set(k, v);
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
  async fetch(req: Request) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    let res: Response;

    // --- Auth (no auth required) ---
    if (legendumSdk.isConfigured()) {
      if (path === "/auth/login" && method === "GET") {
        res = await authHandlers.getLogin(req);
        return addCors(res);
      }
      if (path === "/auth/callback" && method === "GET") {
        res = await authHandlers.getCallback(req);
        return addCors(res);
      }
      if (path === "/auth/logout" && method === "POST") {
        res = await authHandlers.postLogout();
        return addCors(res);
      }
    }

    // --- Public webhook ---
    const webhookMatch = path.match(/^\/w\/([A-Z0-9]{20,30})$/);
    if (webhookMatch) {
      const ulid = webhookMatch[1];
      if (method === "GET")
        return addCors(webhookHandlers.getWebhookTodos(ulid));
      if (method === "PUT" || method === "POST") {
        res = await webhookHandlers.replaceWebhookTodos(req, ulid);
        return addCors(res);
      }
    }

    // SSE
    const sseMatch = path.match(/^\/w\/([A-Z0-9]{20,30})\/events$/);
    if (sseMatch && method === "GET") {
      return addCors(webhookHandlers.sseStream(sseMatch[1], req.signal));
    }

    // --- Static assets ---
    if (path === "/main.css") {
      const file = Bun.file(join(root, "src/web/main.css"));
      if (await file.exists()) {
        return new Response(file, { headers: { "Content-Type": "text/css" } });
      }
    }
    if (path === "/manifest.json") {
      const file = Bun.file(join(root, "src/web/manifest.json"));
      if (await file.exists()) {
        return new Response(file, {
          headers: { "Content-Type": "application/manifest+json" },
        });
      }
    }
    const publicPng: Record<string, string> = {
      "/todos.png": "todos.png",
      "/todos-192.png": "todos-192.png",
      "/todos-512.png": "todos-512.png",
    };
    const pngName = publicPng[path];
    if (pngName) {
      const file = Bun.file(join(root, "public", pngName));
      if (await file.exists()) {
        return new Response(file, { headers: { "Content-Type": "image/png" } });
      }
    }
    if (path === "/dist/sw.js") {
      const file = Bun.file(join(root, "public/dist/sw.js"));
      if (await file.exists()) {
        return new Response(file, {
          headers: {
            "Content-Type": "application/javascript",
            "Cache-Control": "no-cache",
            "Service-Worker-Allowed": "/",
          },
        });
      }
    }
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

    // --- Self-hosted mode: no auth required ---
    if (isSelfHosted()) {
      // Ensure a default user exists
      const db = getDb();
      let user = db.query("SELECT id FROM users LIMIT 1").get() as {
        id: number;
      } | null;
      if (!user) {
        db.run("INSERT INTO users (email) VALUES (?)", LOCAL_USER_EMAIL);
        user = db.query("SELECT id FROM users LIMIT 1").get() as { id: number };
        seedDefaultListsForNewUser(user.id);
      }
      const userId = user.id;

      // Lists API
      if (path === "/" && method === "GET") {
        const accept = req.headers.get("Accept") ?? "";
        if (accept.includes("application/json")) {
          return addCors(listHandlers.indexLists(userId));
        }
        return await serveIndex();
      }
      if (path === "/" && method === "POST") {
        res = await listHandlers.createList(req, userId);
        return addCors(res);
      }
      if (path === "/t/reorder" && method === "PATCH") {
        res = await listHandlers.reorderLists(req, userId);
        return addCors(res);
      }
      if (path === "/t/settings/me" && method === "GET") {
        return addCors(settingsHandlers.getMe(userId));
      }

      // List routes
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
          return addCors(result);
        }
        if (method === "PUT" || method === "POST") {
          res = await listHandlers.replaceTodos(req, slug, userId);
          return addCors(res);
        }
        if (method === "PATCH") {
          res = await listHandlers.renameList(req, slug, userId);
          return addCors(res);
        }
        if (method === "DELETE") {
          return addCors(listHandlers.deleteList(slug, userId));
        }
      }

      // SPA fallback
      return await serveIndex();
    }

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

    // POST link-key: Bearer lak_ only → account_token + optional session cookie. Must run before requireAuth.
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
            return addCors(
              new Response(JSON.stringify(data), { status: 200, headers }),
            );
          }
        }
        return addCors(
          new Response(JSON.stringify(data), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return addCors(legendumRes!);
    }

    // Everything below requires auth
    const auth = await requireAuthAsync(req);
    if (auth instanceof Response) return addCors(auth);
    const { userId } = auth;

    // Legendum middleware
    if (legendumMiddleware) {
      const legendumRes = await legendumMiddleware(req, userId);
      if (legendumRes) return addCors(legendumRes);
    }

    // Lists API
    if (path === "/" && method === "GET") {
      return addCors(listHandlers.indexLists(userId));
    }
    if (path === "/" && method === "POST") {
      res = await listHandlers.createList(req, userId);
      return addCors(res);
    }
    if (path === "/t/reorder" && method === "PATCH") {
      res = await listHandlers.reorderLists(req, userId);
      return addCors(res);
    }
    if (path === "/t/settings/me" && method === "GET") {
      return addCors(settingsHandlers.getMe(userId));
    }

    // List routes (authenticated)
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
        return addCors(result);
      }
      if (method === "PUT" || method === "POST") {
        res = await listHandlers.replaceTodos(req, slug, userId);
        return addCors(res);
      }
      if (method === "PATCH") {
        res = await listHandlers.renameList(req, slug, userId);
        return addCors(res);
      }
      if (method === "DELETE") {
        return addCors(listHandlers.deleteList(slug, userId));
      }
    }

    return addCors(json({ error: "not_found", reason: "route" }, 404));
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
