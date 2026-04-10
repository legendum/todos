import { useEffect, useRef, useState } from "react";

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
};

export default function TopBar({ isSelfHosted }: Props) {
  const [linkState, setLinkState] = useState<LinkState>({
    status: "loading",
    balance: null,
    error: null,
  });
  const ctrlRef = useRef<any>(null);

  const wasLinkedRef = useRef(false);

  const legendumLinked = linkState.status === "linked";
  const lowCredits =
    legendumLinked &&
    linkState.balance !== null &&
    linkState.balance < 50;

  // Auto-logout when Legendum is unlinked
  useEffect(() => {
    if (legendumLinked) {
      wasLinkedRef.current = true;
    } else if (wasLinkedRef.current && linkState.status === "unlinked") {
      fetch("/auth/logout", { method: "POST", credentials: "include" })
        .finally(() => window.location.reload());
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
        <img
          src="/todos.png"
          alt="Todos"
          style={{ width: 28, height: 28, borderRadius: 6 }}
        />
        <span style={{ fontWeight: 600, fontSize: 16 }}>Todos</span>
      </div>
      {!isSelfHosted && linkController && (
        <div className="topbar-right">
          {legendumLinked ? (
            <a
              href={ctrlRef.current?.accountUrl || "https://legendum.co.uk/account"}
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
    </header>
  );
}
