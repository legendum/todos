// Server-only barrel for `pues/base/pwa/`. Build-time helpers
// (`buildPwa`, `buildPwaManifest`, `buildServiceWorker`) and the
// `Bun.serve` route helper (`mountPwaRoutes`) live here — anything
// that imports `node:fs`, `node:crypto`, `workbox-build`, or parses
// `pues.yaml` from disk. The client-safe symbols (`registerServiceWorker`,
// `onReconnect`) stay in the default barrel. See SPEC §9.6.

export { buildPwa, type BuildPwaArgs, type BuildPwaResult } from "./buildPwa";
export {
  buildPwaManifest,
  type BuildPwaManifestResult,
} from "./buildPwaManifest";
export {
  type AdditionalAsset,
  buildServiceWorker,
  type BuildServiceWorkerArgs,
  type BuildServiceWorkerResult,
} from "./buildServiceWorker";
export {
  mountPwaRoutes,
  type MountPwaRoutesResult,
} from "./mountPwaRoutes";
export { type PwaConfig, type ResolvedPwaConfig, readPwaConfig } from "./config";
