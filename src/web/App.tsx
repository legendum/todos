import { useCallback, useEffect, useRef, useState } from "react";
import Lists from "./components/Lists";
import Login from "./components/Login";
import TodoList from "./components/TodoList";
import TopBar from "./components/TopBar";
import { setUnauthorizedHandler } from "./fetchWithAuth";
import { listFromTodoJson, type TodoListJson } from "./listFromJson";
import { findListInCache, type ListEntry } from "./offlineDb";

type User = {
  legendum_linked: boolean;
  hosted: boolean;
};

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
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedList, setSelectedList] = useState<ListEntry | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const filterInputRef = useRef<HTMLInputElement>(null);
  const isSelfHosted = user ? !user.hosted : false;

  const fetchUser = useCallback(async () => {
    try {
      const res = await fetch("/t/settings/me", { credentials: "include" });
      if (!res.ok) {
        setUser(null);
        return;
      }
      const data = (await res.json()) as User;
      setUser(data);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
  }, []);

  useEffect(() => {
    fetchUser().finally(() => setLoading(false));
  }, [fetchUser]);

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
    return <Login />;
  }

  return (
    <>
      <TopBar
        isSelfHosted={isSelfHosted}
        filterQuery={filterQuery}
        setFilterQuery={setFilterQuery}
        filterInputRef={filterInputRef}
      />
      <div style={{ display: selectedList ? "none" : undefined }}>
        <Lists
          onSelect={selectList}
          filterQuery={filterQuery}
          filterInputRef={filterInputRef}
          visible={selectedList === null}
        />
      </div>
      {selectedList ? (
        <TodoList
          key={selectedList.slug}
          list={selectedList}
          filterQuery={filterQuery}
          onBack={goBack}
          onRenamed={({ name, slug }) => {
            setSelectedList((prev) => (prev ? { ...prev, name, slug } : null));
            window.history.replaceState(null, "", `/${slug}`);
          }}
        />
      ) : null}
    </>
  );
}
