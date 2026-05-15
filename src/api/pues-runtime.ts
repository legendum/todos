/**
 * Module-level handle to the pues SSE broadcast function.
 *
 * Pues' own POST/PATCH/DELETE handlers broadcast `lists.created/updated/...`
 * automatically — they own that wire shape. todos' bespoke handlers that
 * still write list data (markdown editor PUT, doc-history undo/redo,
 * webhook ingest) need the same channel so the home page picks up done/total
 * count changes live.
 *
 * server.ts wires `setPuesBroadcast(puesSse.broadcast)` once at boot; other
 * handlers call `broadcastListUpdated(row)` to push a canonical wire row.
 */

import type { Broadcast } from "pues/base/sse";

let broadcastFn: Broadcast | null = null;

export function setPuesBroadcast(fn: Broadcast): void {
  broadcastFn = fn;
}

export type ListBroadcastRow = {
  ulid: string;
  user_id: number;
  name: string;
  slug: string;
  position: number;
  text: string;
  updated_at?: number;
  created_at?: number;
};

/**
 * Broadcast a `lists.updated` event with the canonical pues wire shape so the
 * home page (which reads `row.text` to compute done/total) can re-render.
 * No-op if pues SSE isn't wired (e.g. during tests that import pieces of the
 * lists handlers without booting the full server).
 */
export function broadcastListUpdated(row: ListBroadcastRow): void {
  if (!broadcastFn) return;
  const wire = {
    id: row.ulid,
    label: row.name,
    position: row.position,
    updated_at: row.updated_at ?? row.created_at ?? 0,
    created_at: row.created_at ?? 0,
    slug: row.slug,
    text: row.text,
  };
  broadcastFn(row.user_id, "lists.updated", wire, { op_id: null });
}
