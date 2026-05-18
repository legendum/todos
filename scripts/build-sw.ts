/**
 * Runs after `bun run build:web`. Reads `config/pues.yaml`'s `pwa:`
 * section, generates `public/manifest.json`, and runs workbox-build
 * for the service worker — all via pues' `buildPwa` helper.
 *
 * Output paths (hardcoded conventions of `base/pwa/`):
 *   public/manifest.json
 *   public/dist/sw.js  (+ workbox-*.js runtime chunks)
 */

import { resolve } from "node:path";
import { buildPwa } from "pues/base/pwa/server";

const root = resolve(import.meta.dirname, "..");

const { count, size, manifestRevision } = await buildPwa({
  root,
  // Manifest + icon192/icon512 (from pues.yaml `pwa:`) auto-precached.
  additionalAssets: [
    { url: "/main.css", path: "src/web/main.css" },
    { url: "/pues/theme.css", path: "pues/base/theme/theme.css" },
    { url: "/pues/objects.css", path: "pues/base/objects/objects.css" },
    { url: "/undo-arrow.svg", path: "public/undo-arrow.svg" },
    { url: "/redo-arrow.svg", path: "public/redo-arrow.svg" },
    { url: "/todos.png", path: "public/todos.png" },
  ],
});

console.log(
  `Service worker: ${count} precache entries, ${size} bytes total ` +
    `(manifest revision ${manifestRevision}).`,
);
