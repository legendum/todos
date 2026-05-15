/**
 * Per-list SSE for the public webhook stream (`/w/:ulid/events`).
 *
 * The home-page / lists-index live stream used to live here too
 * (`subscribeUser` / `broadcastUser`). That responsibility moved to pues'
 * `sseRoute()` once todos adopted `mountResource`. What remains is the
 * per-ulid fan-out the webhook stream needs.
 */

export const SSE_HEARTBEAT_MS = 20_000;

type Listener = (text: string) => void;

const listeners = new Map<string, Set<Listener>>();

export function subscribe(ulid: string, listener: Listener): () => void {
  if (!listeners.has(ulid)) listeners.set(ulid, new Set());
  listeners.get(ulid)!.add(listener);
  return () => {
    const set = listeners.get(ulid);
    if (set) {
      set.delete(listener);
      if (set.size === 0) listeners.delete(ulid);
    }
  };
}

export function broadcast(ulid: string, text: string): void {
  const set = listeners.get(ulid);
  if (!set) return;
  for (const listener of set) {
    listener(text);
  }
}
