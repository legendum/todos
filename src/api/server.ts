import { join, resolve } from "node:path";
import { getDb } from "../lib/db.js";
import { closeTabs } from "../lib/billing.js";
import { isSelfHosted, LOCAL_USER_EMAIL } from "../lib/mode.js";
import { requireAuth, requireAuthAsync } from "./auth-middleware.js";
import { json } from "./json.js";

const root = resolve(import.meta.dir, "../..");

import * as authHandlers from "./handlers/auth.js";
import * as categoryHandlers from "./handlers/categories.js";
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
    <link rel="icon" type="image/png" sizes="512x512" href="/todos.png" />
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
      return addCors(webhookHandlers.sseStream(sseMatch[1]));
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
    if (path === "/todos.png") {
      const file = Bun.file(join(root, "public/todos.png"));
      if (await file.exists()) {
        return new Response(file, { headers: { "Content-Type": "image/png" } });
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
      }
      const userId = user.id;

      // Categories API
      if (path === "/" && method === "GET") {
        const accept = req.headers.get("Accept") ?? "";
        if (accept.includes("application/json")) {
          return addCors(categoryHandlers.listCategories(userId));
        }
        return await serveIndex();
      }
      if (path === "/" && method === "POST") {
        res = await categoryHandlers.createCategory(req, userId);
        return addCors(res);
      }
      if (path === "/t/reorder" && method === "PATCH") {
        res = await categoryHandlers.reorderCategories(req, userId);
        return addCors(res);
      }
      if (path === "/t/settings/me" && method === "GET") {
        return addCors(settingsHandlers.getMe(userId));
      }

      // Category routes
      const catMatch = path.match(
        /^\/([a-zA-Z0-9][a-zA-Z0-9._-]*)(?:\.(md|json))?$/,
      );
      if (
        catMatch &&
        !path.startsWith("/t/") &&
        !path.startsWith("/w/") &&
        !path.startsWith("/dist/")
      ) {
        const catName = catMatch[1];
        const ext = catMatch[2];

        if (method === "GET") {
          const result = categoryHandlers.getTodos(
            req,
            ext ? `${catName}.${ext}` : catName,
            userId,
          );
          if (result === null) return await serveIndex();
          return addCors(result);
        }
        if (method === "PUT" || method === "POST") {
          res = await categoryHandlers.replaceTodos(req, catName, userId);
          return addCors(res);
        }
        if (method === "PATCH") {
          res = await categoryHandlers.renameCategory(req, catName, userId);
          return addCors(res);
        }
        if (method === "DELETE") {
          return addCors(categoryHandlers.deleteCategory(catName, userId));
        }
      }

      // SPA fallback
      return await serveIndex();
    }

    // --- Authenticated mode ---
    // SPA routes that should serve index.html (before auth check, for browser navigation)
    const isPageNavigation =
      method === "GET" &&
      (req.headers.get("Accept") ?? "").includes("text/html") &&
      !path.startsWith("/t/") &&
      !path.startsWith("/w/") &&
      !path.startsWith("/dist/");

    if (path === "/" && method === "GET") {
      const accept = req.headers.get("Accept") ?? "";
      if (!accept.includes("application/json")) {
        return await serveIndex();
      }
    }

    if (isPageNavigation && path !== "/") {
      return await serveIndex();
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

    // Categories API
    if (path === "/" && method === "GET") {
      return addCors(categoryHandlers.listCategories(userId));
    }
    if (path === "/" && method === "POST") {
      res = await categoryHandlers.createCategory(req, userId);
      return addCors(res);
    }
    if (path === "/t/reorder" && method === "PATCH") {
      res = await categoryHandlers.reorderCategories(req, userId);
      return addCors(res);
    }
    if (path === "/t/settings/me" && method === "GET") {
      return addCors(settingsHandlers.getMe(userId));
    }

    // Category routes (authenticated)
    const catMatch = path.match(
      /^\/([a-zA-Z0-9][a-zA-Z0-9._-]*)(?:\.(md|json))?$/,
    );
    if (
      catMatch &&
      !path.startsWith("/t/") &&
      !path.startsWith("/w/") &&
      !path.startsWith("/dist/")
    ) {
      const catName = catMatch[1];
      const ext = catMatch[2];

      if (method === "GET") {
        const result = categoryHandlers.getTodos(
          req,
          ext ? `${catName}.${ext}` : catName,
          userId,
        );
        if (result === null) return await serveIndex();
        return addCors(result);
      }
      if (method === "PUT" || method === "POST") {
        res = await categoryHandlers.replaceTodos(req, catName, userId);
        return addCors(res);
      }
      if (method === "PATCH") {
        res = await categoryHandlers.renameCategory(req, catName, userId);
        return addCors(res);
      }
      if (method === "DELETE") {
        return addCors(categoryHandlers.deleteCategory(catName, userId));
      }
    }

    return addCors(json({ error: "not_found" }, 404));
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
