/** Pure rules for offline ↔ server markdown sync (used by `syncMarkdown.ts`). */

/** `local` may be a full IndexedDB row or a minimal `{ updatedAt, pending }` snapshot. */
export function shouldFetchMarkdownBody(opts: {
  serverUpdatedAt: number;
  local: { updatedAt: number; pending: boolean } | null;
}): boolean {
  if (opts.local?.pending) return false;
  return opts.serverUpdatedAt > (opts.local?.updatedAt ?? 0);
}
