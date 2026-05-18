/**
 * `onReconnect(callback)` — subscribes to `window.online` and the
 * initial `window.load` (when `navigator.onLine`); fires `callback` on
 * either. Drops the boilerplate that bridges connectivity events to
 * consumer-side resync logic (queue flush, cache pull, etc.).
 *
 * Returns an unsubscribe that removes both listeners. SSR-safe: no-op
 * (and returns a no-op unsubscribe) when `window` is undefined.
 *
 * The `load` arm fires `callback` exactly once at page boot if already
 * online — this is the "first paint after reload while online" case,
 * which most consumers want to treat like a reconnect (refresh stale
 * caches, drain pending writes).
 */

export type ReconnectCallback = () => void | Promise<void>;

export function onReconnect(callback: ReconnectCallback): () => void {
  if (typeof window === "undefined") return () => {};

  const fire = () => {
    void callback();
  };

  const onLine = () => fire();
  window.addEventListener("online", onLine);

  const onLoad = () => {
    if (navigator.onLine) fire();
  };
  if (document.readyState === "complete") {
    onLoad();
  } else {
    window.addEventListener("load", onLoad);
  }

  return () => {
    window.removeEventListener("online", onLine);
    window.removeEventListener("load", onLoad);
  };
}
