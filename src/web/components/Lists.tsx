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
  useDndPositions,
  useResource,
} from "pues/base/objects";
import { ThemeChooser } from "pues/base/theme";
import type { RefObject } from "react";
import { useEffect, useMemo, useState } from "react";

import { countTodos } from "../../lib/todos.js";
import type { ListEntry } from "../offlineDb";
import DragHandle from "./DragHandle";
import EditTextDialog from "./EditTextDialog";
import { useEscape } from "./useEscape";
import { useSwipeToReveal } from "./useSwipeToReveal";

type Props = {
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

export default function Lists({
  onSelect,
  filterQuery,
  filterInputRef,
  visible,
}: Props) {
  const resource = useResource("lists");
  const dnd = useDndPositions({ name: "lists", resource });

  const [renameRow, setRenameRow] = useState<Row | null>(null);
  const [renameText, setRenameText] = useState("");

  const filterTrim = filterQuery.trim().toLowerCase();
  const filterActive = filterTrim.length > 0;

  const visibleRows = useMemo(() => {
    if (!filterActive) return resource.rows;
    return resource.rows.filter((row) => {
      const name = row.label.toLowerCase();
      const slug = (typeof row.slug === "string" ? row.slug : "").toLowerCase();
      const id = String(row.id).toLowerCase();
      return (
        name.includes(filterTrim) ||
        slug.includes(filterTrim) ||
        id.includes(filterTrim)
      );
    });
  }, [resource.rows, filterTrim, filterActive]);

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

  useEscape(!!renameRow, () => setRenameRow(null));

  const handleDelete = async (row: Row) => {
    // Optimistic remove — the server echo over SSE is dropped as our own
    // (X-Op-Id round-trip), so local state must change here, not via SSE.
    const opId = resource.newOpId();
    const snapshot = resource.rows;
    resource.mutate((prev) => prev.filter((r) => r.id !== row.id));
    const res = await fetch(
      `/api/lists/${encodeURIComponent(String(row.id))}`,
      {
        method: "DELETE",
        credentials: "include",
        headers: { "X-Op-Id": opId },
      },
    );
    if (!res.ok) {
      resource.mutate(snapshot);
    }
  };

  const openRename = (row: Row) => {
    setRenameRow(row);
    setRenameText(row.label);
  };

  const saveRename = async () => {
    if (!renameRow) return;
    const trimmed = renameText.trim();
    if (!trimmed || trimmed === renameRow.label) {
      setRenameRow(null);
      return;
    }
    // Optimistic update — see handleDelete for why.
    const opId = resource.newOpId();
    const snapshot = resource.rows;
    const targetId = renameRow.id;
    resource.mutate((prev) =>
      prev.map((r) => (r.id === targetId ? { ...r, label: trimmed } : r)),
    );
    setRenameRow(null);
    const res = await fetch(
      `/api/lists/${encodeURIComponent(String(targetId))}`,
      {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Op-Id": opId,
        },
        body: JSON.stringify({ label: trimmed }),
      },
    );
    if (!res.ok) {
      resource.mutate(snapshot);
    }
  };

  return (
    <div className="screen screen--home">
      {filterActive ? (
        <ul className="list">
          {visibleRows.map((row) => (
            <StaticListRow
              key={String(row.id)}
              row={row}
              onSelect={() => onSelect(rowToListEntry(row))}
              onEdit={() => openRename(row)}
              onDelete={() => void handleDelete(row)}
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
                  onEdit={() => openRename(row)}
                  onDelete={() => void handleDelete(row)}
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
        <ThemeChooser endpoint="/t/settings/me" />
      </div>

      {renameRow && (
        <EditTextDialog
          title="Edit list"
          placeholder="List name"
          text={renameText}
          onChange={setRenameText}
          onSave={saveRename}
          onClose={() => setRenameRow(null)}
        />
      )}
    </div>
  );
}

function SortableListRow({
  row,
  onSelect,
  onEdit,
  onDelete,
}: {
  row: Row;
  onSelect: () => void;
  onEdit: () => void;
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

  const { sliderStyle, slideHandlers, reset, handleClick } = useSwipeToReveal({
    actionCount: 2,
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
    </li>
  );
}

/** Same row, without drag — used while the list is filtered. */
function StaticListRow({
  row,
  onSelect,
  onEdit,
  onDelete,
}: {
  row: Row;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { sliderStyle, slideHandlers, reset, handleClick } = useSwipeToReveal({
    actionCount: 2,
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
    </li>
  );
}
