/**
 * `registerServiceWorker(opts?)` — one-line SW registration from the
 * web entry point. Replaces the boilerplate that bridges
 * `navigator.serviceWorker` registration + the `controllerchange`
 * auto-reload that workbox's `skipWaiting` flow needs.
 *
 * Defaults match the pues build pipeline (`buildPwa` writes to
 * `<root>/public/dist/sw.js`, served at `/dist/sw.js` with
 * `Service-Worker-Allowed: /` — see `mountPwaRoutes`).
 *
 * No-op when `serviceWorker` is unavailable (older browsers, non-HTTPS
 * dev origins that lack worker support).
 */

export type RegisterServiceWorkerOptions = {
  /** Path to the built service worker. Default: `/dist/sw.js`. */
  swPath?: string;
  /** Scope for the SW registration. Default: `/`. */
  scope?: string;
  /**
   * When true (default), reloads the page on `controllerchange` so a
   * freshly-installed SW takes over without the user manually
   * refreshing. Pairs with workbox's `skipWaiting: true` +
   * `clientsClaim: true`.
   */
  reloadOnControllerChange?: boolean;
};

export function registerServiceWorker(
  opts: RegisterServiceWorkerOptions = {},
): void {
  if (typeof navigator === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  const swPath = opts.swPath ?? "/dist/sw.js";
  const scope = opts.scope ?? "/";
  const reloadOnControllerChange = opts.reloadOnControllerChange ?? true;

  navigator.serviceWorker
    .register(swPath, { updateViaCache: "none", scope })
    .catch(() => {});

  if (reloadOnControllerChange) {
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  }
}
