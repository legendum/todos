import { join, resolve } from "node:path";
import {
  COOKIE_NAME,
  configureAuth,
  ensureLocalUser,
  mountAuthRoutes,
  mountLegendum,
  mountUserSettings,
  resolveUser,
  setAuthCookieHeader,
} from "pues/base/auth";
import { isSelfHosted } from "pues/base/core";
import { loadPuesConfig, mountResource } from "pues/base/objects";
import { sseRoute } from "pues/base/sse";
import { chargeListCreate, closeTabs } from "../lib/billing.js";
import { PORT } from "../lib/constants.js";
import { getDb } from "../lib/db.js";
import { countListsForUser, MAX_LISTS_PER_USER } from "../lib/listHistory.js";
import { seedDefaultListsForNewUser } from "../lib/seed-default-lists.js";
import { toSlug, validateListName } from "../lib/todos.js";
import * as listHandlers from "./handlers/lists.js";
import * as webhookHandlers from "./handlers/webhook.js";
import { json } from "./json.js";
import { setPuesBroadcast } from "./pues-runtime.js";

const root = resolve(import.meta.dir, "../..");

// Initialize DB before anything else touches it.
getDb();

// --- pues auth wiring (SPEC §3.X) ---
// `getDb` is the canonical bun:sqlite getter; pues uses it to build the
// default `puesUserStorage` against the standard users-table schema.
configureAuth({ getDb, onNewUser: seedDefaultListsForNewUser });

// --- pues role-mapped resources (SPEC §5) + per-user SSE (SPEC §7) ---
const puesConfig = await loadPuesConfig();
const listsResource = puesConfig.resources?.lists;
if (!listsResource) {
  throw new Error(
    "config/pues.yaml: `resources.lists` is required for the /api/lists route.",
  );
}

const puesSse = sseRoute({ resolveUser });
setPuesBroadcast(puesSse.broadcast);

function rejectJson(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: code, message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const puesRoutes = mountResource({
  db: getDb(),
  name: "lists",
  config: listsResource,
  resolveUser,
  broadcast: puesSse.broadcast,
  beforeInsert: async ({ body, userId }) => {
    const label = typeof body.label === "string" ? body.label : "";
    const nameError = validateListName(label);
    if (nameError) return rejectJson(400, "invalid_request", nameError);

    const slug = toSlug(label);
    const db = getDb();
    const dup = db
      .query("SELECT 1 FROM lists WHERE user_id = ? AND slug = ?")
      .get(userId, slug);
    if (dup) {
      return rejectJson(
        400,
        "invalid_request",
        `A list with URL "${slug}" already exists`,
      );
    }

    if (countListsForUser(userId) >= MAX_LISTS_PER_USER) {
      return rejectJson(
        403,
        "forbidden",
        `List limit reached (${MAX_LISTS_PER_USER} per account)`,
      );
    }

    const chargeError = await chargeListCreate(userId);
    if (chargeError) return chargeError;

    return { ...body, slug };
  },
  beforeUpdate: ({ body, existing, userId }) => {
    if (typeof body.label !== "string") return body;
    const trimmed = body.label.trim();
    if (trimmed === "" || trimmed === existing.label) return body;

    const nameError = validateListName(trimmed);
    if (nameError) return rejectJson(400, "invalid_request", nameError);

    const newSlug = toSlug(trimmed);
    if (newSlug === existing.slug) return body;

    const db = getDb();
    const conflict = db
      .query("SELECT 1 FROM lists WHERE user_id = ? AND slug = ? AND ulid != ?")
      .get(userId, newSlug, existing.id);
    if (conflict) {
      return rejectJson(
        400,
        "invalid_request",
        `A list with URL "${newSlug}" already exists`,
      );
    }
    return { ...body, label: trimmed, slug: newSlug };
  },
});

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

/**
 * Self-hosted bootstrap: if no `pues_session` cookie is present, ensure the
 * local user exists and return a Set-Cookie header for it. Hosted mode
 * returns null — auth there flows through `/pues/auth/*` instead.
 *
 * Returned by `serveIndex` so the SPA shell lands with a cookie attached;
 * subsequent same-origin fetches (including `/pues/me`) then authenticate.
 */
async function selfHostedBootstrapCookie(req: Request): Promise<string | null> {
  if (!isSelfHosted()) return null;
  const cookie = req.headers.get("Cookie") ?? "";
  if (new RegExp(`(?:^|; )${COOKIE_NAME}=`).test(cookie)) return null;
  const userId = await ensureLocalUser();
  return setAuthCookieHeader(userId);
}

async function serveIndex(req: Request): Promise<Response> {
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
    <link rel="stylesheet" href="/pues/theme.css" />
    <link rel="stylesheet" href="/pues/objects.css" />
    <link rel="stylesheet" href="/main.css" />
  </head>
  <body>
    <div id="root"></div>
    ${scriptTag}
  </body>
</html>`;
  const headers: Record<string, string> = { "Content-Type": "text/html" };
  const setCookie = await selfHostedBootstrapCookie(req);
  if (setCookie) headers["Set-Cookie"] = setCookie;
  return new Response(html, { headers });
}

export default {
  port: PORT,
  development: !!process.env.DEV,
  routes: {
    // --- pues role-mapped /api/lists (SPEC §5) + per-user /api/events (SPEC §7) ---
    ...puesRoutes,
    ...puesSse.routes,

    // --- pues auth + Legendum SDK + user settings (SPEC §3.X) ---
    ...mountAuthRoutes(),
    ...mountLegendum(),
    ...mountUserSettings(),

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
    "/pues/theme.css": () =>
      serveStatic(join(root, "pues/base/theme/theme.css"), "text/css"),
    "/pues/objects.css": () =>
      serveStatic(join(root, "pues/base/objects/objects.css"), "text/css"),
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
    // resolution so unauthenticated visitors land on the login UI in hosted
    // mode, and so the self-hosted cookie-mint side-effect happens on page
    // navigation (covered by `serveIndex`).
    const accept = req.headers.get("Accept") ?? "";
    const isPageNavigation =
      method === "GET" &&
      !accept.includes("application/json") &&
      !path.startsWith("/pues/") &&
      !path.startsWith("/w/") &&
      !path.startsWith("/dist/") &&
      !path.match(/\.(md|json)$/);

    if (isPageNavigation) {
      return await serveIndex(req);
    }

    // From here on: bespoke todos routes that own list markdown text +
    // doc-history. Use pues' `resolveUser` so self-hosted requests land on
    // the local user without needing a cookie; hosted requests still go
    // through cookie/bearer auth and 401 if neither is present.
    const userId = await resolveUser(req);
    if (!userId)
      return json({ error: "unauthorized", message: "Not authenticated" }, 401);

    // --- Markdown editor + doc history (pues owns the row; this owns the text) ---
    const docHist = matchListDocHistory(path, method);
    if (docHist) {
      return docHist.kind === "undo"
        ? listHandlers.postListUndo(docHist.slug, userId)
        : listHandlers.postListRedo(docHist.slug, userId);
    }

    const listParsed = matchListPath(path);
    if (
      listParsed &&
      !path.startsWith("/pues/") &&
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
        if (result === null) return await serveIndex(req);
        return result;
      }
      if (method === "PUT" || method === "POST") {
        return await listHandlers.replaceTodos(req, slug, userId);
      }
    }

    // Self-hosted historically served the SPA for any unmatched route;
    // preserve that to avoid surprising existing clients.
    if (isSelfHosted()) return await serveIndex(req);
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
