/**
 * `<Pues>` — root provider for app-wide pues configuration.
 *
 * Wrap your app in `<Pues fetch={authedFetch}>` to supply defaults that
 * every pues hook and component inherits (currently just `fetch`; this
 * is the slot for future configuration knobs too). Per-call options on
 * individual hooks/components — e.g. `useResource(name, { fetch: ... })`
 * — take precedence over the context value, which in turn takes
 * precedence over the global `fetch`.
 *
 * Resolution order, applied by `usePuesFetch`:
 *
 *   options.fetch  >  <Pues fetch={...}>  >  globalThis.fetch
 *
 * Lives in `base/objects/` because the vendor script copies subdirs
 * wholesale (see fifos/scripts/pues.ts) and this is where the bulk of
 * fetch-using hooks live. `<ThemeChooser>` does not read context — it
 * accepts an explicit `fetch?` prop instead, keeping `base/theme/`
 * vendorable without `base/objects/`.
 */

import { createContext, type ReactNode, useContext, useMemo } from "react";

type PuesValue = {
  fetch?: typeof fetch;
};

const PuesContext = createContext<PuesValue>({});

export type PuesProps = {
  /** Default `fetch` implementation for pues hooks. A consumer-supplied
   * wrapper (e.g. one that catches 401s for centralized logout) can be
   * supplied here once at the root, rather than threaded through every
   * call site. Individual hook options still override. */
  fetch?: typeof fetch;
  children: ReactNode;
};

export function Pues({ fetch: fetchImpl, children }: PuesProps) {
  const value = useMemo<PuesValue>(() => ({ fetch: fetchImpl }), [fetchImpl]);
  return <PuesContext.Provider value={value}>{children}</PuesContext.Provider>;
}

/** Resolve the fetch implementation for a pues hook/component. Applies
 * the precedence: explicit option > `<Pues>` context > global fetch. */
export function usePuesFetch(override?: typeof fetch): typeof fetch {
  const ctx = useContext(PuesContext);
  return override ?? ctx.fetch ?? fetch;
}
