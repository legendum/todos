import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import DragHandle from "./DragHandle";
import type { Line } from "./lines";
import MarkdownBlock from "./MarkdownBlock";

export default function MarkdownSortableRow({
  line,
}: {
  line: Extract<Line, { isTodo: false }>;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: line.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <div
        className="row-wrap markdown-sortable-row"
        style={{ borderBottom: "none" }}
      >
        <div className="md-sortable-inner">
          <DragHandle listeners={listeners} />
          <MarkdownBlock text={line.text} />
        </div>
      </div>
    </div>
  );
}
