#!/usr/bin/env bun
/**
 * Vendor selected parts of the peer ../pues into ./pues.
 *
 * Which parts to vendor is declared in config/pues.yaml under `pues:`.
 * Inter-part dependencies live in PART_MANIFEST below — the script
 * transitively pulls deps so a consumer asking for `auth` automatically
 * gets `core` + `theme` (etc.) too.
 *
 * Keep PART_MANIFEST in lock-step with pues itself; this file is
 * "constant across consumers" per SPEC §9.1.
 */

import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";

const SRC_BASE = "../pues/base";
const DST_BASE = "pues/base";

// Inter-part dependency graph. Object-keyed so future entries can add
// fields beside `depends:` (e.g. `optional:`, `conflicts_with:`) without
// changing the shape.
const PART_MANIFEST: Record<string, { depends: Record<string, true> }> = {
  core: { depends: {} },
  theme: { depends: { core: true, style: true } },
  auth: { depends: { core: true, theme: true } },
  objects: { depends: { core: true, style: true } },
  sse: { depends: { core: true } },
  pwa: { depends: { style: true } },
  db: { depends: {} },
  style: { depends: {} },
};

function resolveDeps(requested: readonly string[]): string[] {
  const seen = new Set<string>();
  const walk = (p: string) => {
    if (seen.has(p)) return;
    seen.add(p);
    const entry = PART_MANIFEST[p];
    if (!entry) {
      throw new Error(
        `config/pues.yaml lists unknown part "${p}". ` +
          `Known: ${Object.keys(PART_MANIFEST).join(", ")}.`,
      );
    }
    for (const dep of Object.keys(entry.depends)) walk(dep);
  };
  for (const p of requested) walk(p);
  return [...seen];
}

const config = Bun.YAML.parse(await Bun.file("config/pues.yaml").text()) as {
  pues?: string[];
};
const requested = config.pues ?? [];

if (requested.length === 0) {
  console.error("config/pues.yaml has no `pues:` list — nothing to vendor.");
  process.exit(1);
}

if (!existsSync(SRC_BASE)) {
  console.error(`No peer pues found at ${SRC_BASE}`);
  process.exit(1);
}

const parts = resolveDeps(requested);
const auto = parts.filter((p) => !requested.includes(p));

await rm("pues", { recursive: true, force: true });
await mkdir(DST_BASE, { recursive: true });

for (const part of parts) {
  await cp(`${SRC_BASE}/${part}`, `${DST_BASE}/${part}`, { recursive: true });
}

console.log(
  `Vendored pues/base: ${parts.join(", ")}` +
    (auto.length > 0 ? ` (auto-pulled: ${auto.join(", ")})` : ""),
);
