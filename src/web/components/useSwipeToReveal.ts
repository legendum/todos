import { useCallback, useRef, useState } from "react";

const DELETE_WIDTH = 72;
const SNAP_THRESHOLD = DELETE_WIDTH / 2;

export type SwipeToRevealResult = {
  sliderStyle: React.CSSProperties;
  slideHandlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
  };
};

export function useSwipeToReveal(options: { onTap?: () => void } = {}): SwipeToRevealResult {
  const { onTap } = options;
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; offset: number } | null>(null);
  const movedEnough = useRef(false);
  const offsetRef = useRef(offset);
  offsetRef.current = offset;

  const onPointerUp = useCallback(() => {
    if (dragStart.current == null) return;
    const wasRevealed = dragStart.current.offset <= -SNAP_THRESHOLD;
    const snapOpen = offset < -SNAP_THRESHOLD;
    if (!movedEnough.current) {
      if (wasRevealed) {
        setOffset(0);
      } else {
        onTap?.();
      }
    } else {
      setOffset(snapOpen ? -DELETE_WIDTH : 0);
    }
    dragStart.current = null;
    setDragging(false);
  }, [offset, onTap]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    movedEnough.current = false;
    const target = e.target as HTMLElement;
    if (target.closest?.("button.row-delete")) return;
    if (target.closest?.(".drag-handle")) return;
    if (target.closest?.(".todo-checkbox")) return;
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
      const next = Math.max(-DELETE_WIDTH, Math.min(0, dragStart.current.offset + dx));
      setOffset(next);
    },
    [onPointerUp],
  );

  const sliderStyle: React.CSSProperties = {
    transform: `translateX(${offset}px)`,
    transition: dragging ? "none" : "transform 0.15s ease-out",
  };

  return {
    sliderStyle,
    slideHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  };
}
