/**
 * `puesAuthedFetch(baseFetch?)` — a fetch wrapper that propagates 401
 * responses to a subscriber. Plus `onPuesUnauthorized(cb)` — pues-
 * internal subscription used by `useUser` to flip the user state to
 * `null` when the server starts returning 401 mid-session.
 *
 * Replaces the per-consumer monkey-patch / hand-rolled wrapper pattern
 * (todos `fetchWithAuth.ts`, fifos `authedFetch.ts`). Consumer wiring
 * collapses to:
 *
 *     <Pues fetch={puesAuthedFetch()}>
 *       <App />
 *     </Pues>
 *
 * with no separate setUnauthorizedHandler call — `useUser` auto-
 * subscribes on mount.
 *
 * Exemptions:
 *   - Cross-origin requests (the consumer is not authoritative for
 *     them; a 401 from a third-party API does not mean "log the user
 *     out of this app").
 *   - Requests to `/pues/auth/*` (the OAuth flow itself; a 401 during
 *     login should not bounce the user back to the login screen mid-
 *     flow).
 */

const PUES_AUTH_PREFIX = "/pues/auth/";

let unauthorizedHandler: (() => void) | null = null;

/**
 * Subscribe to 401 events from `puesAuthedFetch`. Returns an
 * unsubscribe function. Pues-internal — `useUser` calls this on mount
 * and unmount. Consumers do not call this directly.
 *
 * Only one subscriber is supported at a time (the last one wins). This
 * matches the only-one-useUser-per-app reality and avoids the
 * complexity of a set / EventTarget for no current benefit.
 */
export function onPuesUnauthorized(cb: () => void): () => void {
  unauthorizedHandler = cb;
  return () => {
    if (unauthorizedHandler === cb) unauthorizedHandler = null;
  };
}

function resolveRequestUrl(input: RequestInfo | URL): URL | null {
  if (typeof window === "undefined") return null;
  try {
    if (typeof input === "string") {
      return new URL(input, window.location.origin);
    }
    if (input instanceof URL) return input;
    if (input instanceof Request) {
      return new URL(input.url, window.location.origin);
    }
  } catch {
    return null;
  }
  return null;
}

function shouldFireUnauthorized(url: URL | null): boolean {
  if (typeof window === "undefined") return true;
  if (!url) return true;
  if (url.origin !== window.location.origin) return false;
  if (url.pathname.startsWith(PUES_AUTH_PREFIX)) return false;
  return true;
}

/**
 * Wrap a base `fetch` with 401-handling. Defaults to the global `fetch`
 * when called without arguments. The returned function matches the
 * native `fetch` signature, so it drops in as the `fetch` prop on
 * `<Pues>` or as an explicit override on any pues hook.
 *
 * On a 401 response: if the request was same-origin and not under
 * `/pues/auth/`, the registered unauthorized handler (if any) fires
 * after the response resolves. The response itself is always returned
 * to the caller unchanged.
 */
export function puesAuthedFetch(baseFetch: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    if (response.status === 401 && unauthorizedHandler) {
      const url = resolveRequestUrl(input);
      if (shouldFireUnauthorized(url)) unauthorizedHandler();
    }
    return response;
  };
}
