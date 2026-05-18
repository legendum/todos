export {
  isByLegendum,
  isSelfHosted,
  LOCAL_USER_EMAIL,
  setByLegendum,
} from "./mode";
export {
  Pues,
  type PuesProps,
  type PuesUser,
  usePuesFetch,
  usePuesUser,
} from "./Pues";
// Outside-React fetch wrapper. `<Pues>` uses this internally to wrap the
// supplied/global fetch with the 401-handler; consumers reach for it
// directly at module scope (CLI scripts, top-level helpers, service
// workers) where a React hook is not available. Same wrapper, same
// subscription chain, no monkey-patch.
export { wrapFetchWithUnauthorized as puesAuthedFetch } from "./unauthorizedHandler";
