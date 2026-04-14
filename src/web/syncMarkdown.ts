import { shouldFetchMarkdownBody } from "../lib/markdownSyncPolicy.js";
import {
  type CategoryListEntry,
  getMarkdown,
  getPendingMarkdowns,
  saveCategoriesList,
  saveMarkdown,
} from "./offlineDb";

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
      const res = await fetch(`/${slug}`, {
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
  let list: CategoryListEntry[];
  try {
    const listRes = await fetch("/", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!listRes.ok) return;
    const data = (await listRes.json()) as { categories: CategoryListEntry[] };
    list = data.categories;
    await saveCategoriesList(list);
  } catch {
    return;
  }

  for (const cat of list) {
    const local = await getMarkdown(cat.slug);
    if (
      !shouldFetchMarkdownBody({
        serverUpdatedAt: cat.updated_at,
        local,
      })
    )
      continue;
    try {
      const res = await fetch(`/${cat.slug}.md`, { credentials: "include" });
      if (!res.ok) continue;
      const text = await res.text();
      const h = res.headers.get("X-Updated-At");
      const updatedAt = h ? parseInt(h, 10) : cat.updated_at;
      await saveMarkdown({
        slug: cat.slug,
        text,
        updatedAt,
        pending: false,
      });
    } catch {
      /* ignore per-category errors */
    }
  }
}
