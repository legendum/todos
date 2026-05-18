import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AddButton,
  type Row,
  type UseResourceResult,
  useDelete,
  useDndPositions,
  useFilter,
  useSwipeToReveal,
} from "pues/base/objects";
import { ThemeChooser } from "pues/base/theme";
import type { RefObject } from "react";
import { useEffect } from "react";

import { countTodos } from "../../lib/todos.js";
import type { ListEntry } from "../offlineDb";
import DragHandle from "./DragHandle";

type Props = {
  resource: UseResourceResult;
  onSelect: (entry: ListEntry) => void;
  filterQuery: string;
  filterInputRef: RefObject<HTMLInputElement | null>;
  visible: boolean;
};

/**
 * Adapt a pues row (canonical wire shape + slug/text passthroughs) into the
 * `ListEntry` shape that the rest of the todos web layer still consumes.
 */
function rowToListEntry(row: Row): ListEntry {
  const text = typeof row.text === "string" ? row.text : "";
  const { total, done } = countTodos(text);
  return {
    name: row.label,
    slug: typeof row.slug === "string" ? row.slug : "",
    ulid: String(row.id),
    position: row.position,
    total,
    done,
    updated_at: typeof row.updated_at === "number" ? row.updated_at : 0,
  };
}

/** Module-level so its identity is stable across renders (avoids needless
 * useFilter recomputation). Matches the canonical label + the `slug` and
 * `id` passthroughs. */
function matchListRow(row: Row, query: string): boolean {
  const q = query.toLowerCase();
  const slug = typeof row.slug === "string" ? row.slug : "";
  return (
    row.label.toLowerCase().includes(q) ||
    slug.toLowerCase().includes(q) ||
    String(row.id).toLowerCase().includes(q)
  );
}

/** Selectors that should not initiate a swipe gesture. The pues defaults
 * cover `.row-edit` / `.row-delete` / `.drag-handle`; these are todos'
 * row-internal affordances. */
const SWIPE_IGNORE = [".todo-checkbox", "a.text-inline-link"];

export default function Lists({
  resource,
  onSelect,
  filterQuery,
  filterInputRef,
  visible,
}: Props) {
  const dnd = useDndPositions({ name: "lists", resource });
  const { del } = useDelete({ resource, resourceName: "lists" });

  const { active: filterActive, visibleRows } = useFilter(
    resource.rows,
    filterQuery,
    matchListRow,
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { distance: 6 } }),
  );

  /** Home list only: move focus to filter so typing narrows the list immediately. */
  useEffect(() => {
    if (!visible) return;
    const id = requestAnimationFrame(() => {
      filterInputRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [visible, filterInputRef]);

  return (
    <div className="screen screen--home">
      {filterActive ? (
        <ul className="list">
          {visibleRows.map((row) => (
            <StaticListRow
              key={String(row.id)}
              row={row}
              onSelect={() => onSelect(rowToListEntry(row))}
              onDelete={() => void del(row.id)}
            />
          ))}
        </ul>
      ) : (
        <DndContext
          sensors={sensors}
          onDragEnd={dnd.onDragEnd as (e: DragEndEvent) => void}
        >
          <SortableContext
            items={visibleRows.map((row) => String(row.id))}
            strategy={verticalListSortingStrategy}
          >
            <ul className="list">
              {visibleRows.map((row) => (
                <SortableListRow
                  key={String(row.id)}
                  row={row}
                  onSelect={() => onSelect(rowToListEntry(row))}
                  onDelete={() => void del(row.id)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {!resource.loading && visibleRows.length === 0 && !filterActive && (
        <p style={{ padding: 16, color: "#64748b", textAlign: "center" }}>
          No todo lists yet. Tap + to create one.
        </p>
      )}

      {filterActive && visibleRows.length === 0 && (
        <p style={{ padding: 16, color: "#64748b", textAlign: "center" }}>
          No matches.
        </p>
      )}

      <AddButton
        resource="lists"
        placeholder="List name"
        onCreated={(row) => {
          window.dispatchEvent(new Event("todos-credits-refresh"));
          onSelect(rowToListEntry(row));
        }}
      />

      <div className="links-list-theme links-list-theme--home">
        <p className="links-list-theme-label">Theme</p>
        <ThemeChooser />
      </div>
    </div>
  );
}

function SortableListRow({
  row,
  onSelect,
  onDelete,
}: {
  row: Row;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: String(row.id) });

  const { sliderStyle, slideHandlers, handleClick } = useSwipeToReveal({
    actionCount: 1,
    ignoreSelectors: SWIPE_IGNORE,
  });

  const text = typeof row.text === "string" ? row.text : "";
  const { total, done } = countTodos(text);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <li className="row-wrap" ref={setNodeRef} style={style} {...attributes}>
      <div className="row-slider" style={sliderStyle} {...slideHandlers}>
        <div className="row-main" onClick={() => handleClick(onSelect)}>
          <div className="list-item" style={{ borderBottom: "none" }}>
            <DragHandle listeners={listeners} />
            <div className="list-item-content" style={{ marginLeft: 8 }}>
              <div className="list-item-title">{row.label}</div>
            </div>
            <span className="cat-count">
              {done}/{total}
            </span>
          </div>
        </div>
        <button type="button" className="row-delete" onClick={onDelete}>
          Delete
        </button>
      </div>
    </li>
  );
}

/** Same row, without drag — used while the list is filtered. */
function StaticListRow({
  row,
  onSelect,
  onDelete,
}: {
  row: Row;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { sliderStyle, slideHandlers, handleClick } = useSwipeToReveal({
    actionCount: 1,
    ignoreSelectors: SWIPE_IGNORE,
  });
  const text = typeof row.text === "string" ? row.text : "";
  const { total, done } = countTodos(text);

  return (
    <li className="row-wrap">
      <div className="row-slider" style={sliderStyle} {...slideHandlers}>
        <div className="row-main" onClick={() => handleClick(onSelect)}>
          <div className="list-item" style={{ borderBottom: "none" }}>
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
            <div className="list-item-content" style={{ marginLeft: 8 }}>
              <div className="list-item-title">{row.label}</div>
            </div>
            <span className="cat-count">
              {done}/{total}
            </span>
          </div>
        </div>
        <button type="button" className="row-delete" onClick={onDelete}>
          Delete
        </button>
      </div>
    </li>
  );
}
