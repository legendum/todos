/**
 * Runs after `bun run build:web`. Builds the pues stylesheet, the PWA
 * manifest, and the service worker — all via pues helpers.
 *
 * Output paths (hardcoded conventions of `base/style/` + `base/pwa/`):
 *   public/dist/pues.css
 *   public/manifest.json
 *   public/dist/sw.js  (+ workbox-*.js runtime chunks)
 */

import { resolve } from "node:path";
import { buildPwa } from "pues/base/pwa/server";
import { buildStyle } from "pues/base/style";

const root = resolve(import.meta.dirname, "..");

const styleResult = buildStyle({ root });
console.log(`Style: wrote ${styleResult.path} (${styleResult.bytes} bytes).`);

const { count, size, manifestRevision } = await buildPwa({
  root,
  // Manifest + icon192/icon512 (from pues.yaml `pwa:`) auto-precached.
  additionalAssets: [
    { url: "/main.css", path: "src/web/main.css" },
    { url: "/dist/pues.css", path: "public/dist/pues.css" },
    { url: "/undo-arrow.svg", path: "public/undo-arrow.svg" },
    { url: "/redo-arrow.svg", path: "public/redo-arrow.svg" },
    { url: "/todos.png", path: "public/todos.png" },
  ],
});

console.log(
  `Service worker: ${count} precache entries, ${size} bytes total ` +
    `(manifest revision ${manifestRevision}).`,
);
