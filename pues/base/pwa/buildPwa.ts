/**
 * `buildPwa({ root, additionalAssets? })` — one-call replacement for a
 * consumer's `scripts/build-sw.ts`. Generates the manifest from
 * `pues.yaml`'s `pwa:` section, runs the service-worker build, and
 * wires the manifest revision into workbox's precache so a manifest
 * edit (rename / theme color tweak / icon swap) busts the SW cache on
 * the next deploy.
 *
 * Output paths are hardcoded conventions of the part:
 *   <root>/public/manifest.json
 *   <root>/public/dist/sw.js  (+ workbox-*.js runtime chunks)
 * Surfaced at the call site via a leading comment; not opts. Consumers
 * with bespoke pipelines compose `buildPwaManifest` + `buildServiceWorker`
 * directly.
 *
 * `cacheId` defaults to `<package.json#name>-<package.json#version>`
 * (matching todos' existing pattern). Override via opts when the
 * consumer wants a different namespace.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildPwaManifest } from "./buildPwaManifest";
import {
  type AdditionalAsset,
  type BuildServiceWorkerResult,
  buildServiceWorker,
} from "./buildServiceWorker";
import { readPwaConfig } from "./config";

export type BuildPwaArgs = {
  root: string;
  /** Cache namespace prefix. Default: `<pkg.name>-<pkg.version>`. */
  cacheId?: string;
  /**
   * Non-JS files the SW should precache. The pues-generated manifest
   * and the two icons from the `pwa:` section are added automatically;
   * list everything else the SPA fetches statically (CSS, images,
   * fonts).
   */
  additionalAssets?: AdditionalAsset[];
};

export type BuildPwaResult = BuildServiceWorkerResult & {
  manifestPath: string;
  manifestRevision: string;
};

function defaultCacheId(root: string): string {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    name?: string;
    version?: string;
  };
  const name = pkg.name ?? "app";
  const version = pkg.version ?? "0.0.0";
  return `${name}-${version}`;
}

/** Map an icon URL like `/todos-192.png` to its on-disk path under `public/`. */
function iconAsset(url: string): AdditionalAsset {
  return { url, path: `public${url}` };
}

export async function buildPwa({
  root,
  cacheId,
  additionalAssets = [],
}: BuildPwaArgs): Promise<BuildPwaResult> {
  const cfg = await readPwaConfig(root);

  const { path: manifestPath, revision: manifestRevision } =
    await buildPwaManifest({ root });

  const sw = await buildServiceWorker({
    root,
    cacheId: cacheId ?? defaultCacheId(root),
    additionalAssets: [
      { url: "/manifest.json", path: "public/manifest.json" },
      iconAsset(cfg.icon192),
      iconAsset(cfg.icon512),
      ...additionalAssets,
    ],
  });

  return { ...sw, manifestPath, manifestRevision };
}
