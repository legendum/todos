/** List-header undo/redo: artwork lives in `/public/undo-arrow.svg` and `redo-arrow.svg`. */
export function DocHistoryUndoArrow() {
  return (
    <span
      className="header-history-arrow header-history-arrow--undo"
      aria-hidden
    />
  );
}

export function DocHistoryRedoArrow() {
  return (
    <span
      className="header-history-arrow header-history-arrow--redo"
      aria-hidden
    />
  );
}
