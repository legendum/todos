/**
 * `buildPwaManifest({ root })` — read `pues.yaml`'s `pwa:` section,
 * write `<root>/public/manifest.json` with derived defaults, and
 * return its SHA256 revision so the service-worker build can include
 * it in `additionalManifestEntries`.
 *
 * Pues-baked, not configurable: `start_url: "/"`, `display:
 * "standalone"`, icon `type: "image/png"`, `purpose: "any"`. Add more
 * sizes / `purpose: maskable` / `display_override` when a consumer
 * actually needs them (SPEC §3 / iter 9).
 */

import { createHash } from "node:crypto";
import { join } from "node:path";
import { readPwaConfig } from "./config";

export type BuildPwaManifestResult = {
  /** Absolute path to the written manifest. */
  path: string;
  /** Hex SHA256 revision (first 20 chars) of the manifest contents. */
  revision: string;
};

export async function buildPwaManifest({
  root,
}: {
  root: string;
}): Promise<BuildPwaManifestResult> {
  const cfg = await readPwaConfig(root);

  const manifest: Record<string, unknown> = {
    name: cfg.name,
    short_name: cfg.short_name,
    start_url: "/",
    display: "standalone",
    icons: [
      {
        src: cfg.icon192,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: cfg.icon512,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
  if (cfg.background_color) manifest.background_color = cfg.background_color;
  if (cfg.theme_color) manifest.theme_color = cfg.theme_color;

  const body = `${JSON.stringify(manifest, null, 2)}\n`;
  const path = join(root, "public/manifest.json");
  await Bun.write(path, body);

  const revision = createHash("sha256").update(body).digest("hex").slice(0, 20);

  return { path, revision };
}
