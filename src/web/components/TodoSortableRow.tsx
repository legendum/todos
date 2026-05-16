import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useSwipeToReveal } from "pues/base/objects";
import CheckIcon from "./CheckIcon";
import DragHandle from "./DragHandle";
import type { Line } from "./lines";
import { TodoMarkdownText } from "./MarkdownBlock";

const SWIPE_IGNORE = [".todo-checkbox", "a.text-inline-link"];

export default function TodoSortableRow({
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
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: line.id });
  const { sliderStyle, slideHandlers, reset } = useSwipeToReveal({
    actionCount: 2,
    ignoreSelectors: SWIPE_IGNORE,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const indentPad = (line.indent || "").length * 20;

  const content = (
    <div
      className="todo-row"
      style={indentPad ? { paddingLeft: `${16 + indentPad}px` } : undefined}
    >
      <DragHandle listeners={listeners} />
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
  );

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <div className="row-wrap" style={{ borderBottom: "none" }}>
        <div className="row-slider" style={sliderStyle} {...slideHandlers}>
          <div className="row-main">{content}</div>
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
    </div>
  );
}
