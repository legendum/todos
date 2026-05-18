/**
 * `buildStyle({ root })` — build-time helper. Emits the consumer's
 * `<root>/public/dist/pues.css`. Sibling to `buildPwa` (`base/pwa/`).
 *
 * Output cascade:
 *
 *   layer 1 — :root + [data-theme="light"] blocks. Token values come
 *             from `base/style/tokens.ts` `DEFAULT_TOKENS`, with sparse
 *             overrides from pues.yaml `style.dark` / `style.light`
 *             layered on top. Mode-agnostic knobs from `style.vars`
 *             append a third `:root` block.
 *   layer 2 — `base/style/defaults.css` verbatim: the rules for every
 *             pues-shipped component (ThemeChooser, ObjectList,
 *             AddButton, FilterBar, ObjectDetail, RenameTitle, Dialog).
 *             Every value is `var(--pues-*)`, resolved by layer 1.
 *   layer 3 — `style.css` if set: literal CSS appended last. Escape
 *             hatch for rules the variable surface does not cover.
 *
 * Output path (`<root>/public/dist/pues.css`) is a hardcoded
 * convention of the part, surfaced as a comment at the call site
 * rather than an opt — same lens as `buildPwa`.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { readStyleConfig, type StyleConfig } from "./config";
import { cssVarName, DEFAULT_TOKENS, TOKEN_NAMES } from "./tokens";

export type BuildStyleArgs = {
  root: string;
};

export type BuildStyleResult = {
  /** Absolute path of the emitted `pues.css`. */
  path: string;
  /** Byte length — useful for logs. */
  bytes: number;
};

export function buildStyle({ root }: BuildStyleArgs): BuildStyleResult {
  const cfg = readStyleConfig(root);
  const defaultsCss = readFileSync(
    join(import.meta.dirname, "defaults.css"),
    "utf8",
  );

  const css = render(cfg, defaultsCss);
  const outPath = join(root, "public/dist/pues.css");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, css);
  return { path: outPath, bytes: Buffer.byteLength(css) };
}

function render(cfg: StyleConfig, defaultsCss: string): string {
  const darkDecl = TOKEN_NAMES.map((t) => {
    const v = cfg.dark?.[t] ?? DEFAULT_TOKENS.dark[t];
    return `  ${cssVarName(t)}: ${v};`;
  });
  const lightDecl = TOKEN_NAMES.map((t) => {
    const v = cfg.light?.[t] ?? DEFAULT_TOKENS.light[t];
    return `  ${cssVarName(t)}: ${v};`;
  });

  const blocks: string[] = [];

  blocks.push(
    [
      "/* layer 1: pues theme tokens (base/style/tokens.ts + pues.yaml `style:` overrides) */",
      ":root {",
      "  color-scheme: dark;",
      ...darkDecl,
      "}",
      `[data-theme="light"] {`,
      "  color-scheme: light;",
      ...lightDecl,
      "}",
    ].join("\n"),
  );

  if (cfg.vars && Object.keys(cfg.vars).length > 0) {
    blocks.push(
      [
        "/* layer 1b: mode-agnostic --pues-* knobs from `style.vars` */",
        ":root {",
        ...Object.entries(cfg.vars).map(([k, v]) => `  --${k}: ${v};`),
        "}",
      ].join("\n"),
    );
  }

  blocks.push(
    [
      "/* layer 2: pues default rules (base/style/defaults.css) */",
      defaultsCss.trimEnd(),
    ].join("\n"),
  );

  if (cfg.css) {
    blocks.push(
      [
        "/* layer 3: literal CSS from pues.yaml `style.css` */",
        cfg.css.trimEnd(),
      ].join("\n"),
    );
  }

  return `${blocks.join("\n\n")}\n`;
}
