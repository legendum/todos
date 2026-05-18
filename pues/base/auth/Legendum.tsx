/**
 * `<Legendum>` — the single widget that covers both Legendum auth states.
 *
 *   user === undefined  → render nothing (loading)
 *   user === null       → "Login with Legendum" anchor → /pues/auth/login
 *   user && !user.hosted → render nothing (self-hosted: no Legendum UI)
 *   user && hosted, not yet linked → "Link Legendum" button (calls SDK)
 *   user && hosted, linked        → "$balance · Buy more credits" link
 *
 * Reads tri-state user via `usePuesUser()` (the `<Pues user>` context
 * reader); the consumer must wrap their app in `<Pues user={user}>` for
 * this widget to function.
 *
 * Styling is consumer-driven via `className` (always applied) plus
 * branch-specific `classNameAnon` / `classNameAuthed`. Labels and
 * balance formatting are overridable for localization / brand polish,
 * but the URL surface (`/pues/auth/login`, `/pues/legendum/*`) is
 * hardcoded per the pues namespace convention.
 *
 * The `linkController` is owned internally — consumers do not manage
 * it. After a successful link, the user's `legendum_linked` in the
 * `<Pues user>` context stays stale until the next `useUser` refetch
 * or page reload; the widget itself reflects the linked state
 * immediately via its own SDK subscription.
 */

import { useEffect, useRef, useState } from "react";
import { usePuesUser } from "../core/Pues";

// Bun's bundler resolves bare `require()` statically when targeting
// browsers. `createRequire(import.meta.url)` would also work server-side
// but it depends on `node:module` which is absent in browser bundles —
// at runtime the bundled call throws `createRequire is not a function`.
// `<Legendum>` is browser-only, so we use the bare-require pattern that
// the rest of the consumer codebase (e.g. todos' TopBar) already uses.
const legendumSdk =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("./legendum.js") as typeof import("./legendum");

type LinkControllerState = {
  status: "loading" | "unlinked" | "linking" | "linked" | "error";
  balance: number | null;
  error: string | null;
};

type LinkController = {
  getState(): LinkControllerState;
  checkStatus(): void;
  startLink(): void;
  startAuthAndLink(csrfState?: string | null): void;
  accountUrl: string;
  destroy(): void;
};

export type LegendumProps = {
  /** Class applied to the rendered element in every non-null branch. */
  className?: string;
  /** Additional class for the anonymous login CTA. */
  classNameAnon?: string;
  /** Additional class for the authenticated branches (link / linking / linked). */
  classNameAuthed?: string;
  /** Label for the anonymous login CTA (default "Login with Legendum"). */
  loginLabel?: string;
  /** Label for the "link Legendum" button shown to authed-but-not-linked users. */
  linkLabel?: string;
  /** Suffix on the linked-account link (default "Buy more credits"). */
  buyMoreLabel?: string;
  /** Format the balance (in cents) for display. Default formats as `$X.XX`. */
  formatBalance?: (cents: number) => string;
};

function defaultFormatBalance(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function cn(...classes: (string | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function Legendum(props: LegendumProps = {}) {
  const user = usePuesUser();

  // Loading: render nothing so layout does not jump pre-fetch.
  if (user === undefined) return null;

  // Anonymous: login CTA. (In self-hosted there is always a local user
  // and this branch is unreachable; pues makes no assumption about it.)
  if (user === null) {
    return (
      <a
        className={cn(props.className, props.classNameAnon)}
        href="/pues/auth/login"
      >
        {props.loginLabel ?? "Login with Legendum"}
      </a>
    );
  }

  // Authenticated, self-hosted: no Legendum widget surface.
  if (!user.hosted) return null;

  return <LegendumAuthed {...props} />;
}

function LegendumAuthed(props: LegendumProps) {
  const [state, setState] = useState<LinkControllerState>({
    status: "loading",
    balance: null,
    error: null,
  });
  const controllerRef = useRef<LinkController | null>(null);

  useEffect(() => {
    const controller = legendumSdk.linkController({
      linkUrl: "/pues/legendum/link",
      confirmUrl: "/pues/legendum/confirm",
      statusUrl: "/pues/legendum/status",
      onChange: setState,
    }) as LinkController;
    controllerRef.current = controller;
    controller.checkStatus();
    return () => {
      controller.destroy();
      controllerRef.current = null;
    };
  }, []);

  const classes = cn(props.className, props.classNameAuthed);
  const formatBalance = props.formatBalance ?? defaultFormatBalance;
  const linkLabel = props.linkLabel ?? "Link Legendum";
  const buyMoreLabel = props.buyMoreLabel ?? "Buy more credits";

  if (state.status === "loading" || state.status === "error") return null;

  if (state.status === "unlinked") {
    return (
      <button
        type="button"
        className={classes}
        onClick={() => controllerRef.current?.startLink()}
      >
        {linkLabel}
      </button>
    );
  }

  if (state.status === "linking") {
    return <span className={classes}>Linking…</span>;
  }

  // status === "linked"
  const balance = state.balance ?? 0;
  return (
    <a
      className={classes}
      href={controllerRef.current?.accountUrl}
      target="_blank"
      rel="noopener noreferrer"
    >
      {formatBalance(balance)} · {buyMoreLabel}
    </a>
  );
}
