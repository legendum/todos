import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  categoryFromTodoJson,
  type TodoCategoryJson,
} from "./categoryFromJson";
import CategoriesList from "./components/CategoriesList";
import Login from "./components/Login";
import TodoList from "./components/TodoList";
import TopBar from "./components/TopBar";
import { setUnauthorizedHandler } from "./fetchWithAuth";
import { type CategoryListEntry, findCategoryInList } from "./offlineDb";

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

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] =
    useState<CategoryListEntry | null>(null);
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

  // On initial load, if the URL has a slug, fetch that category (or use cached list)
  useEffect(() => {
    if (!user || loading) return;
    const slug = getSlugFromPath();
    if (!slug) return;

    let cancelled = false;

    void (async () => {
      try {
        const r = await fetch(`/${slug}.json`, {
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (cancelled) return;
        if (r.ok) {
          const data = (await r.json()) as TodoCategoryJson;
          if (data?.slug) setSelectedCategory(categoryFromTodoJson(data));
          return;
        }
      } catch {
        /* fall through to cache */
      }
      const cached = await findCategoryInList(slug);
      if (!cancelled && cached) setSelectedCategory(cached);
    })();

    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  // Listen for popstate (browser back/forward)
  useEffect(() => {
    const onPopState = () => {
      const slug = getSlugFromPath();
      if (!slug) {
        setSelectedCategory(null);
        return;
      }
      void (async () => {
        try {
          const r = await fetch(`/${slug}.json`, {
            credentials: "include",
            headers: { Accept: "application/json" },
          });
          if (r.ok) {
            const data = (await r.json()) as TodoCategoryJson;
            if (data?.slug) {
              setSelectedCategory(categoryFromTodoJson(data));
              return;
            }
          }
        } catch {
          /* cache */
        }
        const cached = await findCategoryInList(slug);
        if (cached) setSelectedCategory(cached);
        else setSelectedCategory(null);
      })();
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const selectCategory = (cat: CategoryListEntry) => {
    setSelectedCategory(cat);
    window.history.pushState(null, "", `/${cat.slug}`);
  };

  const goBack = () => {
    setSelectedCategory(null);
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

  // Typing in the filter while inside a category sends the user back home
  // so they can see the filtered list of categories.
  const handleSetFilterQuery: Dispatch<SetStateAction<string>> = (value) => {
    setFilterQuery(value);
    const next = typeof value === "function" ? value(filterQuery) : value;
    if (next.length > 0 && selectedCategory) goBack();
  };

  return (
    <>
      <TopBar
        isSelfHosted={isSelfHosted}
        filterQuery={filterQuery}
        setFilterQuery={handleSetFilterQuery}
        filterInputRef={filterInputRef}
      />
      <div style={{ display: selectedCategory ? "none" : undefined }}>
        <CategoriesList
          onSelect={selectCategory}
          filterQuery={filterQuery}
          filterInputRef={filterInputRef}
          visible={selectedCategory === null}
        />
      </div>
      {selectedCategory ? (
        <TodoList
          key={selectedCategory.slug}
          category={selectedCategory}
          onBack={goBack}
          onRenamed={({ name, slug }) => {
            setSelectedCategory((prev) =>
              prev ? { ...prev, name, slug } : null,
            );
            window.history.replaceState(null, "", `/${slug}`);
          }}
        />
      ) : null}
    </>
  );
}
