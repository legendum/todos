/**
 * Read + validate the `pwa:` section of `<root>/config/pues.yaml`.
 *
 * Used by `buildPwa` (build-time) and `mountPwaRoutes` (server boot).
 * Throws if the file is missing or unparseable, or if no manifest name
 * can be resolved (neither `pwa.name` nor `core.name` is set). All
 * `pwa:` fields are optional — sensible defaults come from `core.name`
 * (icon slug + display name) and `style.dark` (manifest colours).
 *
 * The pwa part reads pues.yaml directly rather than going through
 * `base/objects/loadPuesConfig`, so a consumer vendoring `pwa` is not
 * forced to also vendor `objects`. It does import `DEFAULT_TOKENS`
 * from `../style/tokens` for manifest-colour fallback — vendoring
 * `pwa` therefore implies vendoring `style`.
 */

import { join } from "node:path";

import { DEFAULT_TOKENS } from "../style/tokens";

export type PwaConfig = {
  /** Manifest `name` (display string shown to users). Defaults to
   * `core.name`; override for capitalisation (e.g. `core.name: todos`,
   * `pwa.name: Todos`). */
  name?: string;
  /** Manifest `short_name`. Defaults to `name`. */
  short_name?: string;
  /** Hex string. Defaults to `style.dark.bg_page` if set, else
   * `DEFAULT_TOKENS.dark.bg_page` from `base/style/tokens`. */
  background_color?: string;
  /** Hex string. Defaults to `style.dark.chrome` if set, else
   * `DEFAULT_TOKENS.dark.chrome` from `base/style/tokens`. */
  theme_color?: string;
  /** 192x192 icon URL. Defaults to `/<core.name>-192.png`. */
  icon192?: string;
  /** 512x512 icon URL. Defaults to `/<core.name>-512.png`. */
  icon512?: string;
};

export type ResolvedPwaConfig = Required<PwaConfig>;

export async function readPwaConfig(root: string): Promise<ResolvedPwaConfig> {
  const path = join(root, "config/pues.yaml");
  let text: string;
  try {
    text = await Bun.file(path).text();
  } catch (cause) {
    throw new Error(`[pues/pwa] could not read ${path}`, { cause });
  }

  const parsed = Bun.YAML.parse(text) as {
    pwa?: PwaConfig;
    core?: { name?: unknown };
    style?: { dark?: { bg_page?: unknown; chrome?: unknown } };
  } | null;
  const pwa = parsed?.pwa ?? {};
  const coreName =
    typeof parsed?.core?.name === "string" && parsed.core.name.length > 0
      ? parsed.core.name
      : undefined;

  // Manifest display name: explicit pwa.name wins; fall back to
  // capitalised core.name (the canonical consumer identifier).
  // `core.name: todos` → manifest name "Todos". Consumer overrides
  // pwa.name only for cases the capitalisation rule does not handle
  // (multi-word, mixed case, brand-specific glyphs). Throw if neither
  // is set — every PWA manifest needs a name.
  const name = pwa.name ?? (coreName ? capitalize(coreName) : undefined);
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(
      `[pues/pwa] ${path}: PWA manifest needs a name. Set 'core.name' (preferred — also used as the icon slug and DB filename) or 'pwa.name'.`,
    );
  }

  // PWA inherits its manifest colors from `style.dark` when `pwa:` omits
  // them, with `base/style/tokens.ts` DEFAULT_TOKENS.dark as the final
  // fallback — manifest spec only supports one set of colors, so dark
  // wins (matches todos+fifos shipping dark-first). Single source of
  // truth, no duplicated constants. Implies vendoring `pwa` also needs
  // `style` — the only consumer pairing pues supports.
  const styleDark = parsed?.style?.dark;
  const inheritedBg =
    typeof styleDark?.bg_page === "string"
      ? styleDark.bg_page
      : DEFAULT_TOKENS.dark.bg_page;
  const inheritedChrome =
    typeof styleDark?.chrome === "string"
      ? styleDark.chrome
      : DEFAULT_TOKENS.dark.chrome;

  // Icon slug: prefer core.name (already the canonical lowercase slug);
  // fall back to lowercasing pwa.name for consumers that have no `core`.
  const slug = coreName ?? name.toLowerCase();
  return {
    name,
    short_name: pwa.short_name ?? name,
    background_color: pwa.background_color ?? inheritedBg,
    theme_color: pwa.theme_color ?? inheritedChrome,
    icon192: pwa.icon192 ?? `/${slug}-192.png`,
    icon512: pwa.icon512 ?? `/${slug}-512.png`,
  };
}

/** Capitalise the first letter; leave the rest as-is. `todos` → `Todos`,
 * `fifos` → `Fifos`. Consumers with multi-word or mixed-case display
 * names override `pwa.name` explicitly. */
function capitalize(s: string): string {
  return s.length > 0 ? `${s[0].toUpperCase()}${s.slice(1)}` : s;
}
