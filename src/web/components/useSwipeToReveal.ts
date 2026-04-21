import { useCallback, useRef, useState } from "react";

const BUTTON_WIDTH = 72;
/** Pointer must move this far before we commit to a gesture direction. */
const DIRECTION_THRESHOLD = 6;

export type SwipeToRevealResult = {
  sliderStyle: React.CSSProperties;
  reset: () => void;
  slideHandlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
  };
};

type GestureMode = "pending" | "horizontal" | "vertical";

export function useSwipeToReveal(
  options: { onTap?: () => void; actionCount?: number } = {},
): SwipeToRevealResult {
  const { onTap, actionCount = 1 } = options;
  const actionsWidth = BUTTON_WIDTH * actionCount;
  const snapThreshold = actionsWidth / 2;
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  /**
   * Gesture classification: on pointerdown we stay "pending" so we don't
   * capture the pointer or preventDefault. Once we see enough movement, we
   * commit to "horizontal" (swipe to reveal) or "vertical" (let the browser
   * scroll the list — no tap, no capture).
   */
  const mode = useRef<GestureMode>("pending");
  const dragStart = useRef<{
    x: number;
    y: number;
    offset: number;
    pointerId: number;
  } | null>(null);
  const offsetRef = useRef(offset);
  offsetRef.current = offset;

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (dragStart.current == null) return;
      const wasRevealed = dragStart.current.offset <= -snapThreshold;
      const snapOpen = offset < -snapThreshold;
      if (mode.current === "pending") {
        if (wasRevealed) {
          setOffset(0);
        } else {
          // Prevent the compat `click` that follows a touch pointerup so
          // it can't land on DOM that appeared under the finger when
          // onTap navigated.
          e.preventDefault();
          onTap?.();
        }
      } else if (mode.current === "horizontal") {
        setOffset(snapOpen ? -actionsWidth : 0);
      }
      // vertical → user was scrolling; do nothing.
      dragStart.current = null;
      mode.current = "pending";
      setDragging(false);
    },
    [offset, onTap, actionsWidth, snapThreshold],
  );

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    mode.current = "pending";
    const target = e.target as HTMLElement;
    if (
      target.closest?.("button.row-delete") ||
      target.closest?.("button.row-edit")
    )
      return;
    if (target.closest?.(".drag-handle")) return;
    if (target.closest?.(".todo-checkbox")) return;
    // Let inline links navigate; pointer capture + preventDefault would block clicks.
    if (target.closest?.("a.text-inline-link")) return;
    // Do NOT capture the pointer here — capture suppresses native vertical
    // scroll on touch. We capture later, only if the gesture is horizontal.
    if (e.pointerType === "mouse") e.preventDefault();
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      offset: offsetRef.current,
      pointerId: e.pointerId,
    };
    setDragging(true);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragStart.current == null) return;
      if (e.pointerType === "mouse" && e.buttons !== 1) {
        onPointerUp(e);
        return;
      }
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;

      if (mode.current === "pending") {
        const ax = Math.abs(dx);
        const ay = Math.abs(dy);
        if (ax < DIRECTION_THRESHOLD && ay < DIRECTION_THRESHOLD) return;
        if (ay > ax) {
          // Vertical scroll — bail out, let the browser handle it.
          mode.current = "vertical";
          dragStart.current = null;
          setDragging(false);
          return;
        }
        mode.current = "horizontal";
        // Now that we know it's a swipe, capture so we keep receiving events
        // even if the finger leaves the row.
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(
            dragStart.current.pointerId,
          );
        } catch {}
      }

      if (mode.current !== "horizontal") return;
      const next = Math.max(
        -actionsWidth,
        Math.min(0, dragStart.current.offset + dx),
      );
      setOffset(next);
    },
    [onPointerUp],
  );

  const sliderStyle: React.CSSProperties = {
    transform: `translateX(${offset}px)`,
    transition: dragging ? "none" : "transform 0.15s ease-out",
  };

  const reset = useCallback(() => setOffset(0), []);

  return {
    sliderStyle,
    reset,
    slideHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  };
}
