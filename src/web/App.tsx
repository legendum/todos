import { Legendum, useUser } from "pues/base/auth";
import { Pues } from "pues/base/core";
import { useResource } from "pues/base/objects";
import { useEffect, useRef, useState } from "react";
import Lists from "./components/Lists";
import TodoList from "./components/TodoList";
import TopBar from "./components/TopBar";
import { setUnauthorizedHandler } from "./fetchWithAuth";
import { listFromTodoJson, type TodoListJson } from "./listFromJson";
import {
  deleteMarkdown,
  findListInCache,
  getMarkdown,
  type ListEntry,
  saveMarkdown,
} from "./offlineDb";

/** Extract slug from the current URL path. Returns null if at root. */
function getSlugFromPath(): string | null {
  const path = window.location.pathname;
  if (path === "/" || path === "") return null;
  // Strip leading slash, ignore paths starting with t/ or w/ or dist/
  const slug = path.slice(1);
  if (
    slug.startsWith("t/") ||
    slug.startsWith("w/") ||
    slug.startsWith("dist/")
  )
    return null;
  return slug || null;
}

/** Resolve a slug to a ListEntry, preferring the network and falling back to
 * the offline list cache. */
async function resolveSlug(slug: string): Promise<ListEntry | null> {
  try {
    const r = await fetch(`/${slug}.json`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (r.ok) {
      const data = (await r.json()) as TodoListJson;
      if (data?.slug) return listFromTodoJson(data);
    }
  } catch {
    /* fall through to cache */
  }
  return (await findListInCache(slug)) ?? null;
}

export default function App() {
  const { user, loading, setUser } = useUser();
  const [selectedList, setSelectedList] = useState<ListEntry | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const filterInputRef = useRef<HTMLInputElement>(null);
  const isSelfHosted = user ? !user.hosted : false;

  // Hoisted resource — single SSE subscription + single fetch shared by
  // Lists (home) and TodoList (detail). `useRename` inside `<RenameTitle>`
  // mutates this resource directly, so the home list stays in sync
  // without any manual prop-callback dance. Gated on `user` so the
  // initial fetch doesn't 401 before login completes.
  const resource = useResource("lists", { enabled: !!user });

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
  }, [setUser]);

  // On initial load, if the URL has a slug, fetch that list (or use cached list)
  useEffect(() => {
    if (!user || loading) return;
    const slug = getSlugFromPath();
    if (!slug) return;

    let cancelled = false;
    void resolveSlug(slug).then((entry) => {
      if (!cancelled && entry) setSelectedList(entry);
    });

    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  // Listen for popstate (browser back/forward)
  useEffect(() => {
    const onPopState = () => {
      const slug = getSlugFromPath();
      if (!slug) {
        setSelectedList(null);
        return;
      }
      void resolveSlug(slug).then((entry) => setSelectedList(entry));
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Reconcile selectedList with the resource. Any rename — home-list
  // swipe, RenameTitle inline rename, an SSE event from another tab —
  // updates the row in resource.rows; this effect syncs the detail-page
  // state + URL, and migrates the offlineDb cache when the slug changes.
  useEffect(() => {
    if (!selectedList) return;
    const row = resource.rows.find((r) => String(r.id) === selectedList.ulid);
    if (!row) return;
    const newName = row.label;
    const rowSlug = typeof row.slug === "string" ? row.slug : null;
    if (!rowSlug) return;
    if (newName === selectedList.name && rowSlug === selectedList.slug) return;
    const oldSlug = selectedList.slug;
    setSelectedList((prev) =>
      prev ? { ...prev, name: newName, slug: rowSlug } : null,
    );
    if (rowSlug !== oldSlug) {
      window.history.replaceState(null, "", `/${rowSlug}`);
      void (async () => {
        const cached = await getMarkdown(oldSlug);
        if (cached) {
          await saveMarkdown({ ...cached, slug: rowSlug });
          await deleteMarkdown(oldSlug);
        }
      })();
    }
  }, [resource.rows, selectedList]);

  const selectList = (entry: ListEntry) => {
    setSelectedList(entry);
    window.history.pushState(null, "", `/${entry.slug}`);
  };

  const goBack = () => {
    setSelectedList(null);
    window.history.pushState(null, "", "/");
  };

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>
        Loading...
      </div>
    );
  }

  if (!user) {
    return (
      <Pues user={null}>
        <div className="login-screen">
          <img src="/todos.png" alt="Todos" className="login-logo" />
          <h1>Todos</h1>
          <p>Todo lists for AI projects, and everything else.</p>
          <Legendum className="btn" />
        </div>
      </Pues>
    );
  }

  return (
    <Pues user={user}>
      <TopBar
        isSelfHosted={isSelfHosted}
        filterQuery={filterQuery}
        setFilterQuery={setFilterQuery}
        filterInputRef={filterInputRef}
      />
      <div style={{ display: selectedList ? "none" : undefined }}>
        <Lists
          resource={resource}
          onSelect={selectList}
          filterQuery={filterQuery}
          filterInputRef={filterInputRef}
          visible={selectedList === null}
        />
      </div>
      {selectedList ? (
        <TodoList
          key={selectedList.ulid}
          resource={resource}
          list={selectedList}
          filterQuery={filterQuery}
          onBack={goBack}
        />
      ) : null}
    </Pues>
  );
}
