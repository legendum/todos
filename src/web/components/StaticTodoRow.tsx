import CheckIcon from "./CheckIcon";
import type { Line } from "./lines";
import { TodoMarkdownText } from "./MarkdownBlock";
import { useSwipeToReveal } from "./useSwipeToReveal";

/**
 * Non-draggable todo row used while a filter is active — reordering a filtered
 * subset would silently rearrange hidden neighbours, so drag is disabled.
 */
export default function StaticTodoRow({
  line,
  onToggle,
  onDelete,
  onEdit,
}: {
  line: Extract<Line, { isTodo: true }>;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const { sliderStyle, slideHandlers, reset } = useSwipeToReveal({
    actionCount: 2,
  });

  const indentPad = (line.indent || "").length * 20;

  return (
    <div className="row-wrap" style={{ borderBottom: "none" }}>
      <div className="row-slider" style={sliderStyle} {...slideHandlers}>
        <div className="row-main">
          <div
            className="todo-row"
            style={
              indentPad ? { paddingLeft: `${16 + indentPad}px` } : undefined
            }
          >
            <div className="drag-handle drag-handle--static" aria-hidden>
              <svg viewBox="0 0 16 16" fill="currentColor">
                <circle cx="5" cy="3" r="1.5" />
                <circle cx="11" cy="3" r="1.5" />
                <circle cx="5" cy="8" r="1.5" />
                <circle cx="11" cy="8" r="1.5" />
                <circle cx="5" cy="13" r="1.5" />
                <circle cx="11" cy="13" r="1.5" />
              </svg>
            </div>
            <button
              type="button"
              className={`todo-checkbox${line.done ? " checked" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
            >
              {line.done && <CheckIcon />}
            </button>
            <span className={`todo-text${line.done ? " done" : ""}`}>
              <TodoMarkdownText text={line.text} />
            </span>
          </div>
        </div>
        <button
          type="button"
          className="row-edit"
          onClick={() => {
            reset();
            onEdit();
          }}
        >
          Edit
        </button>
        <button type="button" className="row-delete" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}
