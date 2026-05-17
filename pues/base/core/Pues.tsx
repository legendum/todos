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
 * Lives in `base/core/` — the *bord* of the smörgåsbord. Other parts
 * (`base/objects/`, `base/theme/`, future `base/auth/`, …) depend on
 * `core` to share this app-root context without prop-drilling. A
 * consumer that wants pues at all vendors `core` plus whichever feature
 * parts it uses.
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
