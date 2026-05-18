import { puesAuthedFetch } from "pues/base/core";
import type { Row } from "pues/base/objects";
import { shouldFetchMarkdownBody } from "../lib/markdownSyncPolicy.js";
import { wireRowToListEntry } from "./listEntry";
import {
  getMarkdown,
  getPendingMarkdowns,
  type ListEntry,
  saveLists,
  saveMarkdown,
} from "./offlineDb";

// Module-scope 401-aware fetch. Same wrapper `<Pues>` uses internally;
// reaching for it here so background reconcile after a reconnect
// participates in session-expiry detection.
const authedFetch = puesAuthedFetch();

/** Push all pending markdown PUTs, then pull server versions that are newer than our cache. */
export async function syncMarkdownAfterReconnect(): Promise<void> {
  await flushPendingMarkdownPuts();
  await pullNewerMarkdownFromServer();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("todos-offline-sync"));
  }
}

async function flushPendingMarkdownPuts(): Promise<void> {
  for (const row of await getPendingMarkdowns()) {
    const { slug, text } = row;
    try {
      const res = await authedFetch(`/${slug}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "text/markdown" },
        body: text,
      });
      if (!res.ok) continue;
      const j = (await res.json()) as { updated_at: number };
      await saveMarkdown({
        slug,
        text,
        updatedAt: j.updated_at,
        pending: false,
      });
    } catch {
      /* still offline or error — leave pending */
    }
  }
}

async function pullNewerMarkdownFromServer(): Promise<void> {
  let list: ListEntry[];
  try {
    const listRes = await authedFetch("/api/lists", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!listRes.ok) return;
    const data = (await listRes.json()) as Row[];
    list = data.map(wireRowToListEntry);
    await saveLists(list);
  } catch {
    return;
  }

  for (const entry of list) {
    const local = await getMarkdown(entry.slug);
    if (
      !shouldFetchMarkdownBody({
        serverUpdatedAt: entry.updated_at,
        local,
      })
    )
      continue;
    try {
      const res = await authedFetch(`/${entry.slug}.md`, {
        credentials: "include",
      });
      if (!res.ok) continue;
      const text = await res.text();
      const h = res.headers.get("X-Updated-At");
      const updatedAt = h ? parseInt(h, 10) : entry.updated_at;
      await saveMarkdown({
        slug: entry.slug,
        text,
        updatedAt,
        pending: false,
      });
    } catch {
      /* ignore per-list errors */
    }
  }
}
