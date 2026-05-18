// Session cookies
export {
  COOKIE_NAME,
  clearAuthCookieHeader,
  createSessionCookie,
  getUserIdFromRequest,
  OAUTH_STATE_COOKIE_NAME,
  setAuthCookieHeader,
  verifySessionCookie,
} from "./cookie";
// Self-hosted bootstrap + the one-line resolveUser helper
export { ensureLocalUser } from "./ensureLocalUser";
export { Legendum, type LegendumProps } from "./Legendum";
// Request → user-id resolution
export {
  getAuthUserId,
  getAuthUserIdWithBearer,
  requireAuth,
  requireAuthAsync,
} from "./middleware";
// Server route mounting (return route-map objects for the consumer's
// `routes:` block).
export { mountAuthRoutes } from "./mountAuthRoutes";
export { mountLegendum } from "./mountLegendum";
export { mountUserSettings } from "./mountUserSettings";
// Default canonical-schema UserStorage adapter (built into
// configureAuth when `getDb` is supplied; also exported for consumers
// that want to wrap or compose it).
export { puesUserStorage } from "./puesUserStorage";
export { resolveUser } from "./resolveUser";
// Startup config + env-derived values. `configureAuth` is the single
// public entry point for wiring storage + lifecycle hooks; the
// underlying `setUserStorage` / `getUserStorage` are pues-internal.
export type { AuthConfig } from "./startup";
export { configureAuth, getCookieSecret, getDomain } from "./startup";
// Storage types — consumers writing a custom adapter need these. The
// `setUserStorage` / `getUserStorage` setters stay pues-internal; wire
// via `configureAuth({ storage: ... })` instead.
export type { Awaitable, UserRow, UserStorage } from "./storage";
// Client-side data fetcher + widget
export { type UseUserResult, useUser } from "./useUser";
