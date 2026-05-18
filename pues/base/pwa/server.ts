// Server-only barrel for `pues/base/pwa/`. Build-time helpers
// (`buildPwa`, `buildPwaManifest`, `buildServiceWorker`) and the
// `Bun.serve` route helper (`mountPwaRoutes`) live here — anything
// that imports `node:fs`, `node:crypto`, `workbox-build`, or parses
// `pues.yaml` from disk. The client-safe symbols (`registerServiceWorker`,
// `onReconnect`) stay in the default barrel. See SPEC §9.6.

export { type BuildPwaArgs, type BuildPwaResult, buildPwa } from "./buildPwa";
export {
  type BuildPwaManifestResult,
  buildPwaManifest,
} from "./buildPwaManifest";
export {
  type AdditionalAsset,
  type BuildServiceWorkerArgs,
  type BuildServiceWorkerResult,
  buildServiceWorker,
} from "./buildServiceWorker";
export {
  type PwaConfig,
  type ResolvedPwaConfig,
  readPwaConfig,
} from "./config";
export {
  type MountPwaRoutesResult,
  mountPwaRoutes,
} from "./mountPwaRoutes";
