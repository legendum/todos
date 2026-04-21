import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";
import InstallDialog from "./InstallDialog";

// @ts-expect-error — pure JS SDK
let linkController: any = null;
try {
  linkController = require("../../lib/legendum.js").linkController;
} catch {}

type LinkState = {
  status: "loading" | "unlinked" | "linking" | "linked" | "error";
  balance: number | null;
  error: string | null;
};

type Props = {
  isSelfHosted?: boolean;
  filterQuery: string;
  setFilterQuery: Dispatch<SetStateAction<string>>;
  filterInputRef: RefObject<HTMLInputElement | null>;
};

export default function TopBar({
  isSelfHosted,
  filterQuery,
  setFilterQuery,
  filterInputRef,
}: Props) {
  const [linkState, setLinkState] = useState<LinkState>({
    status: "loading",
    balance: null,
    error: null,
  });
  const ctrlRef = useRef<any>(null);
  const [showInstall, setShowInstall] = useState(false);

  const wasLinkedRef = useRef(false);

  const legendumLinked = linkState.status === "linked";
  const lowCredits =
    legendumLinked && linkState.balance !== null && linkState.balance < 50;

  // Auto-logout when Legendum is unlinked
  useEffect(() => {
    if (legendumLinked) {
      wasLinkedRef.current = true;
    } else if (wasLinkedRef.current && linkState.status === "unlinked") {
      fetch("/auth/logout", { method: "POST", credentials: "include" }).finally(
        () => window.location.reload(),
      );
    }
  }, [legendumLinked, linkState.status]);

  useEffect(() => {
    if (isSelfHosted || !linkController) return;

    const ctrl = linkController({
      mountAt: "/t/legendum",
      onChange: setLinkState,
    });
    ctrlRef.current = ctrl;
    ctrl.checkStatus();

    const intervalId = setInterval(() => ctrl.checkStatus(), 60_000);

    return () => {
      clearInterval(intervalId);
      ctrl.destroy();
      ctrlRef.current = null;
    };
  }, [isSelfHosted]);

  return (
    <header className="topbar">
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
        <label
          className="list-filter topbar-search-filter"
          htmlFor="todos-category-list-filter"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="list-filter-icon" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle
                cx="11"
                cy="11"
                r="7"
                stroke="currentColor"
                strokeWidth="2"
              />
              <path
                d="M20 20l-3-3"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <input
            ref={filterInputRef}
            id="todos-category-list-filter"
            type="search"
            className="list-filter-input"
            placeholder="Filter..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label="Filter lists by name or slug"
            enterKeyHint="search"
          />
          {filterQuery ? (
            <button
              type="button"
              className="list-filter-clear"
              onClick={() => setFilterQuery("")}
              aria-label="Clear search"
            >
              ×
            </button>
          ) : null}
        </label>
      </div>
      {!isSelfHosted && linkController && (
        <div className="topbar-right">
          {legendumLinked ? (
            <a
              href={
                ctrlRef.current?.accountUrl || "https://legendum.co.uk/account"
              }
              target="_blank"
              rel="noopener noreferrer"
              className={`legendum-btn legendum-linked${lowCredits ? " low-credits" : ""}`}
            >
              <span className="legendum-icon">&#x2C60;</span>
              <span>
                {linkState.balance !== null
                  ? `${linkState.balance.toLocaleString()} Credits`
                  : "Credits"}
              </span>
            </a>
          ) : linkState.status === "unlinked" ||
            linkState.status === "linking" ||
            linkState.status === "error" ? (
            <button
              className="legendum-btn legendum-link"
              onClick={() => ctrlRef.current?.startLink()}
              disabled={linkState.status === "linking"}
            >
              <span className="legendum-icon">&#x2C60;</span>
              <span>
                {linkState.status === "linking"
                  ? "Linking..."
                  : linkState.status === "error"
                    ? "Retry"
                    : "Link Legendum"}
              </span>
            </button>
          ) : null}
        </div>
      )}
      {showInstall && <InstallDialog onClose={() => setShowInstall(false)} />}
    </header>
  );
}
