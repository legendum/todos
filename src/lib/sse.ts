/** Simple SSE broadcaster keyed by list ULID. */

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

/** Authenticated home/overview stream — keyed by user id. */
type UserListsListener = (listsJsonLine: string) => void;

const userListeners = new Map<number, Set<UserListsListener>>();

export function subscribeUser(
  userId: number,
  listener: UserListsListener,
): () => void {
  if (!userListeners.has(userId)) userListeners.set(userId, new Set());
  userListeners.get(userId)!.add(listener);
  return () => {
    const set = userListeners.get(userId);
    if (set) {
      set.delete(listener);
      if (set.size === 0) userListeners.delete(userId);
    }
  };
}

export function broadcastUser(userId: number, listsJsonLine: string): void {
  const set = userListeners.get(userId);
  if (!set) return;
  for (const listener of set) {
    listener(listsJsonLine);
  }
}
