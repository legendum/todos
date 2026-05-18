/**
 * Read + validate the `pwa:` section of `<root>/config/pues.yaml`.
 *
 * Used by `buildPwa` (build-time) and `mountPwaRoutes` (server boot).
 * Throws if the file is missing, unparseable, or the section absent —
 * the contract is "if `pwa` is in `parts:`, `pwa:` is required" (SPEC
 * §9.1 part-keyed config rule).
 *
 * The pwa part deliberately reads pues.yaml itself rather than going
 * through `base/objects/loadPuesConfig`, so a consumer vendoring `pwa`
 * is not forced to also vendor `objects`.
 */

import { join } from "node:path";

export type PwaConfig = {
  /** Required. Used as the manifest `name`. */
  name: string;
  /** Manifest `short_name`. Defaults to `name`. */
  short_name?: string;
  /** Hex string. Omitted from output if unset. */
  background_color?: string;
  /** Hex string. Omitted from output if unset. */
  theme_color?: string;
  /** 192x192 icon URL. Defaults to `/<lowercased name>-192.png`. */
  icon192?: string;
  /** 512x512 icon URL. Defaults to `/<lowercased name>-512.png`. */
  icon512?: string;
};

export type ResolvedPwaConfig = Required<
  Pick<PwaConfig, "name" | "short_name" | "icon192" | "icon512">
> & {
  background_color?: string;
  theme_color?: string;
};

export async function readPwaConfig(root: string): Promise<ResolvedPwaConfig> {
  const path = join(root, "config/pues.yaml");
  let text: string;
  try {
    text = await Bun.file(path).text();
  } catch (cause) {
    throw new Error(`[pues/pwa] could not read ${path}`, { cause });
  }

  const parsed = Bun.YAML.parse(text) as { pwa?: PwaConfig } | null;
  const pwa = parsed?.pwa;
  if (!pwa) {
    throw new Error(
      `[pues/pwa] ${path} is missing the required 'pwa:' section. ` +
        `If 'pwa' is in 'parts:', a top-level 'pwa:' key is required ` +
        `(SPEC §9.1 part-keyed config).`,
    );
  }
  if (typeof pwa.name !== "string" || pwa.name.length === 0) {
    throw new Error(
      `[pues/pwa] ${path} 'pwa.name' is required and must be a non-empty string.`,
    );
  }

  const slug = pwa.name.toLowerCase();
  return {
    name: pwa.name,
    short_name: pwa.short_name ?? pwa.name,
    background_color: pwa.background_color,
    theme_color: pwa.theme_color,
    icon192: pwa.icon192 ?? `/${slug}-192.png`,
    icon512: pwa.icon512 ?? `/${slug}-512.png`,
  };
}
