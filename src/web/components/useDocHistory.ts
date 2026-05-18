import { usePuesFetch } from "pues/base/core";
import { useCallback, useEffect, useRef, useState } from "react";

/** How long the error banner stays visible before auto-clearing. */
const ERROR_DISPLAY_MS = 5000;

/**
 * List-document undo/redo: POSTs to `/:slug/:kind`, exposes a busy flag for
 * disabling the buttons mid-request, and a transient error string that
 * auto-clears after 5s. The hook stays focused on network + error state;
 * integrating the new text into local state, IndexedDB, and any in-memory
 * caches is the parent's responsibility via `onTextLoaded`.
 */
export function useDocHistory({
  slug,
  online,
  onTextLoaded,
}: {
  slug: string;
  online: boolean;
  onTextLoaded: (text: string, updatedAt: number) => Promise<void> | void;
}): {
  busy: boolean;
  error: string | null;
  run: (kind: "undo" | "redo") => Promise<void>;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const authedFetch = usePuesFetch();

  useEffect(() => {
    return () => {
      if (errorTimerRef.current !== null) {
        clearTimeout(errorTimerRef.current);
      }
    };
  }, []);

  const setTransientError = useCallback((msg: string) => {
    setError(msg);
    if (errorTimerRef.current !== null) {
      clearTimeout(errorTimerRef.current);
    }
    errorTimerRef.current = setTimeout(() => {
      errorTimerRef.current = null;
      setError(null);
    }, ERROR_DISPLAY_MS);
  }, []);

  const run = useCallback(
    async (kind: "undo" | "redo") => {
      if (!online || busy) return;
      setBusy(true);
      setError(null);
      try {
        const res = await authedFetch(`/${slug}/${kind}`, {
          method: "POST",
          credentials: "include",
        });
        let data: { message?: string; text?: string; updated_at?: number } = {};
        try {
          data = (await res.json()) as typeof data;
        } catch {
          /* non-JSON */
        }
        if (!res.ok) {
          const msg =
            typeof data.message === "string"
              ? data.message
              : `${kind === "undo" ? "Undo" : "Redo"} failed`;
          setTransientError(msg);
          return;
        }
        const text = data.text;
        const updatedAt = data.updated_at;
        if (typeof text !== "string" || typeof updatedAt !== "number") {
          setTransientError("Unexpected response from server");
          return;
        }
        await onTextLoaded(text, updatedAt);
      } finally {
        setBusy(false);
      }
    },
    [busy, slug, online, onTextLoaded, setTransientError, authedFetch],
  );

  return { busy, error, run };
}
