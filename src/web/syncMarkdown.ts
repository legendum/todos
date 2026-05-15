import { shouldFetchMarkdownBody } from "../lib/markdownSyncPolicy.js";
import { countTodos } from "../lib/todos";
import {
  getMarkdown,
  getPendingMarkdowns,
  type ListEntry,
  saveLists,
  saveMarkdown,
} from "./offlineDb";

type PuesListWire = {
  id: string;
  label: string;
  position: number;
  updated_at?: number;
  slug?: string;
  text?: string;
};

function wireToListEntry(w: PuesListWire): ListEntry {
  const text = typeof w.text === "string" ? w.text : "";
  const { total, done } = countTodos(text);
  return {
    name: w.label,
    slug: typeof w.slug === "string" ? w.slug : "",
    ulid: w.id,
    position: w.position,
    total,
    done,
    updated_at: typeof w.updated_at === "number" ? w.updated_at : 0,
  };
}

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
  let list: ListEntry[];
  try {
    const listRes = await fetch("/api/lists", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!listRes.ok) return;
    const data = (await listRes.json()) as PuesListWire[];
    list = data.map(wireToListEntry);
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
      const res = await fetch(`/${entry.slug}.md`, { credentials: "include" });
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
