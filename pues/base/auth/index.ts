// Client-safe barrel for `pues/base/auth/`. Only browser-bundle-safe
// symbols belong here — anything that imports a `node:` module or Bun
// built-in lives in `./server` instead (imported as
// `pues/base/auth/server`). See SPEC §9.6.

export { Legendum, type LegendumProps } from "./Legendum";
export { type UseUserResult, useUser } from "./useUser";
