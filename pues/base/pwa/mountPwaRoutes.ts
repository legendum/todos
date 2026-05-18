/**
 * `mountPwaRoutes({ root })` → `{ routes, fetch }`. One call lifts
 * every PWA-related URL off the consumer's `server.ts`:
 *
 *   /manifest.json           served from <root>/public/manifest.json
 *   /dist/sw.js              served from <root>/public/dist/sw.js
 *                            with `Service-Worker-Allowed: /` and
 *                            `Cache-Control: no-cache`
 *   /<icon192>, /<icon512>   served from <root>/public/<url> (image/png)
 *
 * Plus the wildcard handler in `fetch(req)` that covers
 * `/dist/workbox-*.js` (and source maps) — workbox emits hash-named
 * runtime chunks at build time, so they cannot be a literal route.
 * Call it from your Bun.serve `fetch` as a one-line fall-through:
 *
 *   const pwaHit = await pwa.fetch(req);
 *   if (pwaHit) return pwaHit;
 *
 * Mirrors `sseRoute`'s `{ routes, fetch }` shape. Throws at mount time
 * if `pues.yaml` is missing the `pwa:` section.
 */

import { join } from "node:path";
import { readPwaConfig } from "./config";

type RouteHandler = () => Response | Promise<Response>;
type RouteMap = Record<string, RouteHandler>;

export type MountPwaRoutesResult = {
  routes: RouteMap;
  /** Returns a Response for PWA wildcard hits, or `null` otherwise. */
  fetch: (req: Request) => Promise<Response | null>;
};

const WORKBOX_RE = /^\/dist\/(workbox-[a-f0-9]+\.js(?:\.map)?)$/;

function serve(
  path: string,
  contentType: string,
  extraHeaders: HeadersInit = {},
): RouteHandler {
  return () =>
    new Response(Bun.file(path), {
      headers: { "Content-Type": contentType, ...extraHeaders },
    });
}

export async function mountPwaRoutes({
  root,
}: {
  root: string;
}): Promise<MountPwaRoutesResult> {
  const cfg = await readPwaConfig(root);

  const routes: RouteMap = {
    "/manifest.json": serve(
      join(root, "public/manifest.json"),
      "application/manifest+json",
    ),
    "/dist/sw.js": serve(
      join(root, "public/dist/sw.js"),
      "application/javascript",
      {
        "Service-Worker-Allowed": "/",
        "Cache-Control": "no-cache",
      },
    ),
    [cfg.icon192]: serve(join(root, "public", cfg.icon192), "image/png"),
    [cfg.icon512]: serve(join(root, "public", cfg.icon512), "image/png"),
  };

  async function fetchHandler(req: Request): Promise<Response | null> {
    const path = new URL(req.url).pathname;
    const m = WORKBOX_RE.exec(path);
    if (!m) return null;
    const file = Bun.file(join(root, "public/dist", m[1]));
    if (!(await file.exists())) return null;
    const isMap = path.endsWith(".map");
    return new Response(file, {
      headers: {
        "Content-Type": isMap ? "application/json" : "application/javascript",
        "Cache-Control": isMap ? "no-cache" : "public, max-age=86400",
      },
    });
  }

  return { routes, fetch: fetchHandler };
}
