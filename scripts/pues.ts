#!/usr/bin/env bun
/**
 * Vendor selected parts of the peer ../pues into ./pues.
 *
 * Which parts to vendor is declared in config/pues.yaml under `pues:`.
 * The inter-part dependency graph (`PUES_MANIFEST`) lives in pues
 * itself at `base/core/manifest.ts`; the script bootstrap-copies the
 * `core/` part, then imports the manifest from the *local* vendored
 * copy, then copies the remaining parts. The peer pues is treated as
 * a file source only — never imported across the project boundary.
 *
 * This file is "constant across consumers" per SPEC §9.1: copy
 * verbatim during adoption; never branch by consumer.
 */

import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";

const SRC_BASE = "../pues/base";
const DST_BASE = "pues/base";

if (!existsSync(SRC_BASE)) {
  console.error(`No peer pues found at ${SRC_BASE}`);
  process.exit(1);
}

const config = Bun.YAML.parse(await Bun.file("config/pues.yaml").text()) as {
  pues?: string[];
};
const requested = config.pues ?? [];

if (requested.length === 0) {
  console.error("config/pues.yaml has no `pues:` list — nothing to vendor.");
  process.exit(1);
}

// Bootstrap: wipe, then copy `core/` so the local manifest is fresh.
await rm("pues", { recursive: true, force: true });
await mkdir(DST_BASE, { recursive: true });
await cp(`${SRC_BASE}/core`, `${DST_BASE}/core`, { recursive: true });

if (!existsSync(`${DST_BASE}/core/manifest.ts`)) {
  console.error(
    `Bootstrap copy of base/core did not produce manifest.ts. ` +
      `Is the peer pues at ../pues up to date?`,
  );
  process.exit(1);
}

// Resolve transitive deps from the local vendored manifest.
const { resolveDeps } = await import("../pues/base/core/manifest");
const parts = resolveDeps(requested);
const auto = parts.filter((p) => !requested.includes(p));

// Copy the remaining parts. `core/` already done in the bootstrap.
for (const part of parts) {
  if (part === "core") continue;
  await cp(`${SRC_BASE}/${part}`, `${DST_BASE}/${part}`, { recursive: true });
}

console.log(
  `Vendored pues/base: ${parts.join(", ")}` +
    (auto.length > 0 ? ` (auto-pulled: ${auto.join(", ")})` : ""),
);
