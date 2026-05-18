/**
 * `mountLegendum()` — mounts the legendum SDK middleware under
 * `/pues/legendum/*` and subsumes the link-key cookie-mint side-effect
 * that consumers used to glue on themselves.
 *
 * Returns `{}` when `isByLegendum()` is false (self-hosted mode); the
 * SDK isn't configured and there's nothing to mount.
 *
 * SDK routes handled:
 *   - POST /link, /auth-link, /link-key  (public)
 *   - POST /issue-key, /confirm          (authenticated, userId via cookie/bearer)
 *   - GET  /status                       (authenticated)
 *
 * The `/link-key` route additionally appends a `Set-Cookie` for the
 * just-linked user — this is the only side-effect pues bolts on top of
 * the SDK. Everything else is pure pass-through.
 *
 * Storage adapters compose directly from `UserStorage` (token CRUD).
 * `onLinkKey` find-or-creates the user and fires `onNewUser`, matching
 * the OAuth callback semantics.
 */

import { createRequire } from "node:module";
import { isByLegendum } from "../core/mode";
import { setAuthCookieHeader } from "./cookie";
import { requireAuthAsync } from "./middleware";
import { getAuthConfig } from "./startup";
import { getUserStorage } from "./storage";

const require = createRequire(import.meta.url);
const legendumSdk =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("./legendum.js") as typeof import("./legendum");

type RouteHandler = (req: Request) => Response | Promise<Response>;

const PREFIX = "/pues/legendum";

function notFound(): Response {
  return new Response(JSON.stringify({ error: "not_found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}

type MiddlewareClient = Parameters<typeof legendumSdk.middleware>[0]["client"];

function buildMiddleware(
  client?: MiddlewareClient,
): (req: Request, ...extra: unknown[]) => Promise<Response | null | undefined> {
  return legendumSdk.middleware({
    prefix: PREFIX,
    client,
    getToken: async (_req: Request, ...extra: unknown[]) => {
      const userId = extra[0] as number;
      return await getUserStorage().getLegendumToken(userId);
    },
    setToken: async (
      _req: Request,
      accountToken: string,
      ...extra: unknown[]
    ) => {
      const userId = extra[0] as number;
      await getUserStorage().updateLegendumToken(userId, accountToken);
    },
    clearToken: async (_req: Request, ...extra: unknown[]) => {
      const userId = extra[0] as number;
      await getUserStorage().updateLegendumToken(userId, null);
    },
    onLinkKey: async (
      _req: Request,
      accountToken: string,
      email: string | null,
    ) => {
      if (!email) return;
      const storage = getUserStorage();
      let user = await storage.findUserByEmail(email);
      if (!user) {
        user = await storage.createUser({
          email,
          legendumToken: accountToken,
        });
        const config = getAuthConfig();
        if (config.onNewUser) await config.onNewUser(user.id);
      } else if (user.legendum_token !== accountToken) {
        await storage.updateLegendumToken(user.id, accountToken);
      }
    },
  });
}

/**
 * Mount the legendum SDK routes. `opts.client` is an escape hatch
 * mainly for tests — pass a mock SDK client to bypass real network /
 * API-key resolution. Production callers omit it and the SDK uses
 * `create()` to build a client from env.
 */
export function mountLegendum(opts?: {
  client?: MiddlewareClient;
}): Record<string, Record<string, RouteHandler>> {
  if (!isByLegendum()) return {};

  const middleware = buildMiddleware(opts?.client);

  const linkKey: RouteHandler = async (req) => {
    const res = await middleware(req);
    if (!res || res.status !== 200) return res ?? notFound();

    // After-middleware: `onLinkKey` already find-or-created the user.
    // Mint a session cookie so the bearer flow opens a browser session.
    const bodyText = await res.text();
    let email: string | undefined;
    try {
      const parsed = JSON.parse(bodyText) as { email?: string };
      email = parsed.email;
    } catch {
      /* malformed body — pass through without cookie */
    }
    if (!email) {
      return new Response(bodyText, {
        status: res.status,
        headers: res.headers,
      });
    }
    const user = await getUserStorage().findUserByEmail(email);
    if (!user) {
      return new Response(bodyText, {
        status: res.status,
        headers: res.headers,
      });
    }
    const headers = new Headers(res.headers);
    headers.append("Set-Cookie", setAuthCookieHeader(user.id));
    return new Response(bodyText, { status: 200, headers });
  };

  const publicDelegate: RouteHandler = async (req) => {
    const res = await middleware(req);
    return res ?? notFound();
  };

  const authedDelegate: RouteHandler = async (req) => {
    const auth = await requireAuthAsync(req);
    if (auth instanceof Response) return auth;
    const res = await middleware(req, auth.userId);
    return res ?? notFound();
  };

  return {
    [`${PREFIX}/link`]: { POST: publicDelegate },
    [`${PREFIX}/auth-link`]: { POST: publicDelegate },
    [`${PREFIX}/link-key`]: { POST: linkKey },
    [`${PREFIX}/issue-key`]: { POST: authedDelegate },
    [`${PREFIX}/confirm`]: { POST: authedDelegate },
    [`${PREFIX}/status`]: { GET: authedDelegate },
  };
}
