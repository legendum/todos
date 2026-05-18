import { Legendum } from "pues/base/auth";
import { FilterBar } from "pues/base/objects";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";
import InstallDialog from "./InstallDialog";

type Props = {
  filterQuery: string;
  setFilterQuery: Dispatch<SetStateAction<string>>;
  filterInputRef: RefObject<HTMLInputElement | null>;
};

const LEGENDUM_ICON = <span className="legendum-icon">&#x2C60;</span>;

function formatCreditsBalance(cents: number): string {
  return cents !== null ? `${cents.toLocaleString()} Credits` : "Credits";
}

export default function TopBar({
  filterQuery,
  setFilterQuery,
  filterInputRef,
}: Props) {
  const headerRef = useRef<HTMLElement | null>(null);
  const [showInstall, setShowInstall] = useState(false);

  // Keep the fixed topbar pinned to the top of the VISUAL viewport on iOS
  // so opening the mobile keyboard (and any resulting page scroll) cannot
  // hide the header/filter row.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const el = headerRef.current;
      if (el) el.style.transform = `translateY(${vv.offsetTop}px)`;
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return (
    <header className="topbar" ref={headerRef}>
      <div className="topbar-left">
        <button
          type="button"
          className="topbar-logo-btn"
          onClick={() => setShowInstall(true)}
          aria-label="About Todos"
        >
          <img
            src="/todos.png"
            alt=""
            style={{ width: 28, height: 28, borderRadius: 6 }}
          />
        </button>
        <FilterBar
          query={filterQuery}
          setQuery={setFilterQuery}
          inputRef={filterInputRef}
          placeholder="Filter..."
          ariaLabel="Filter lists by name or slug"
          id="todos-list-filter"
          className="topbar-search-filter"
        />
      </div>
      <div className="topbar-right">
        <Legendum
          className="legendum-btn"
          classNameLinked="legendum-linked"
          classNameUnlinked="legendum-link"
          classNameLowCredits="low-credits"
          iconSlot={LEGENDUM_ICON}
          linkLabel="Link Legendum"
          linkingLabel="Linking..."
          errorLabel="Retry"
          formatBalance={formatCreditsBalance}
          lowCreditsThreshold={50}
          pollIntervalMs={60_000}
          refreshOnEvent="todos-credits-refresh"
          autoLogoutOnUnlink
        />
      </div>
      {showInstall && <InstallDialog onClose={() => setShowInstall(false)} />}
    </header>
  );
}
