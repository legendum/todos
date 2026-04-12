import { useCallback, useRef, useState } from "react";

const BUTTON_WIDTH = 72;

export type SwipeToRevealResult = {
  sliderStyle: React.CSSProperties;
  reset: () => void;
  slideHandlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
  };
};

export function useSwipeToReveal(
  options: { onTap?: () => void; actionCount?: number } = {},
): SwipeToRevealResult {
  const { onTap, actionCount = 1 } = options;
  const actionsWidth = BUTTON_WIDTH * actionCount;
  const snapThreshold = actionsWidth / 2;
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; offset: number } | null>(null);
  const movedEnough = useRef(false);
  const offsetRef = useRef(offset);
  offsetRef.current = offset;

  const onPointerUp = useCallback(() => {
    if (dragStart.current == null) return;
    const wasRevealed = dragStart.current.offset <= -snapThreshold;
    const snapOpen = offset < -snapThreshold;
    if (!movedEnough.current) {
      if (wasRevealed) {
        setOffset(0);
      } else {
        onTap?.();
      }
    } else {
      setOffset(snapOpen ? -actionsWidth : 0);
    }
    dragStart.current = null;
    setDragging(false);
  }, [offset, onTap, actionsWidth, snapThreshold]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    movedEnough.current = false;
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
    if (e.pointerType === "mouse") e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragStart.current = { x: e.clientX, offset: offsetRef.current };
    setDragging(true);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragStart.current == null) return;
      if (e.pointerType === "mouse" && e.buttons !== 1) {
        onPointerUp();
        return;
      }
      const dx = e.clientX - dragStart.current.x;
      if (Math.abs(dx) > 5) movedEnough.current = true;
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
