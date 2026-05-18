/**
 * `buildServiceWorker({ root, cacheId, additionalAssets })` — wraps
 * `workbox-build`'s `generateSW` with pues' opinions baked in:
 *
 *   - `cleanupOutdatedCaches: true`
 *   - `skipWaiting: true`
 *   - `clientsClaim: true`
 *   - `globPatterns: ["**\/*.js"]` (only the hashed JS bundles)
 *   - `globIgnores: ["sw.js", "sw.js.map", "workbox-*.js",
 *     "workbox-*.js.map"]`
 *   - clears any pre-existing `sw.js` / `workbox-*` files first so
 *     each build is hermetic
 *
 * `additionalAssets` is the list of non-JS files (CSS, icons, images,
 * the manifest) the SW should precache; pues SHA256s each one and
 * passes the result to workbox as `additionalManifestEntries`. The
 * consumer never thinks about revisions.
 *
 * Output is `<root>/public/dist/sw.js`. Companion runtime chunks
 * (`workbox-*.js`) land next to it.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { generateSW } from "workbox-build";

export type AdditionalAsset = {
  /** Public URL the SW should match against. */
  url: string;
  /** Path on disk (relative to `root`, or absolute) used to compute the revision. */
  path: string;
};

export type BuildServiceWorkerArgs = {
  root: string;
  /** Cache namespace prefix, e.g. `todos-0.1.0`. */
  cacheId: string;
  additionalAssets?: AdditionalAsset[];
};

export type BuildServiceWorkerResult = {
  /** Number of precache entries workbox wrote. */
  count: number;
  /** Total byte size of the precache. */
  size: number;
};

function revisionFor(absolutePath: string): string {
  const buf = readFileSync(absolutePath);
  return createHash("sha256").update(buf).digest("hex").slice(0, 20);
}

export async function buildServiceWorker({
  root,
  cacheId,
  additionalAssets = [],
}: BuildServiceWorkerArgs): Promise<BuildServiceWorkerResult> {
  const distDir = resolve(root, "public/dist");

  if (existsSync(distDir)) {
    for (const name of readdirSync(distDir)) {
      if (
        name === "sw.js" ||
        name.startsWith("sw.js.") ||
        name.startsWith("workbox-")
      ) {
        unlinkSync(join(distDir, name));
      }
    }
  }

  const additionalManifestEntries = additionalAssets.map(({ url, path }) => ({
    url,
    revision: revisionFor(resolve(root, path)),
  }));

  const { count, size, warnings } = await generateSW({
    swDest: join(distDir, "sw.js"),
    globDirectory: distDir,
    globPatterns: ["**/*.js"],
    globIgnores: ["sw.js", "sw.js.map", "workbox-*.js", "workbox-*.js.map"],
    cacheId,
    cleanupOutdatedCaches: true,
    skipWaiting: true,
    clientsClaim: true,
    additionalManifestEntries,
  });

  for (const w of warnings) console.warn(w);
  return { count, size };
}
