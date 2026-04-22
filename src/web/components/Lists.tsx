import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getLists, type ListEntry, saveLists } from "../offlineDb";
import { patchListName } from "../patchListName";
import DragHandle from "./DragHandle";
import EditTextDialog from "./EditTextDialog";
import { useSwipeToReveal } from "./useSwipeToReveal";

type Props = {
  onSelect: (entry: ListEntry) => void;
  filterQuery: string;
  filterInputRef: RefObject<HTMLInputElement | null>;
  visible: boolean;
};

export default function Lists({
  onSelect,
  filterQuery,
  filterInputRef,
  visible,
}: Props) {
  const [lists, setLists] = useState<ListEntry[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [renameList, setRenameList] = useState<ListEntry | null>(null);
  const [renameText, setRenameText] = useState("");

  const filterTrim = filterQuery.trim().toLowerCase();
  const filteredLists = useMemo(() => {
    if (!filterTrim) return lists;
    return lists.filter(
      (c) =>
        c.name.toLowerCase().includes(filterTrim) ||
        c.slug.toLowerCase().includes(filterTrim) ||
        c.ulid.toLowerCase().includes(filterTrim),
    );
  }, [lists, filterTrim]);

  const filterActive = filterTrim.length > 0;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { distance: 6 } }),
  );

  const fetchLists = useCallback(async () => {
    try {
      const res = await fetch("/", {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { lists: ListEntry[] };
      setLists(data.lists);
      await saveLists(data.lists);
    } catch {
      const cached = await getLists();
      if (cached) setLists(cached);
    }
  }, []);

  useEffect(() => {
    if (visible) fetchLists();
  }, [visible, fetchLists]);

  /** Home list only: move focus to filter so typing narrows the list immediately. */
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      filterInputRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const onSync = () => {
      void fetchLists();
    };
    window.addEventListener("todos-offline-sync", onSync);
    return () => window.removeEventListener("todos-offline-sync", onSync);
  }, [fetchLists]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setError(null);
    const res = await fetch("/", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    if (!res.ok) {
      const data = (await res.json()) as { message?: string };
      setError(data.message || "Failed to create list");
      return;
    }
    setNewName("");
    setCreating(false);
    await fetchLists();
    window.dispatchEvent(new Event("todos-credits-refresh"));
  };

  const handleDelete = async (slug: string) => {
    await fetch(`/${slug}`, { method: "DELETE", credentials: "include" });
    await fetchLists();
  };

  const openRename = (entry: ListEntry) => {
    setRenameList(entry);
    setRenameText(entry.name);
  };

  const saveRename = async () => {
    if (!renameList) return;
    const trimmed = renameText.trim();
    if (!trimmed || trimmed === renameList.name) {
      setRenameList(null);
      return;
    }
    const data = await patchListName(renameList.slug, trimmed);
    if (data) {
      setRenameList(null);
      await fetchLists();
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    const oldIndex = lists.findIndex((c) => c.slug === activeId);
    const newIndex = lists.findIndex((c) => c.slug === overId);
    if (oldIndex < 0 || newIndex < 0) return;

    const next = arrayMove(lists, oldIndex, newIndex);
    setLists(next);

    fetch("/t/reorder", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: next.map((c) => c.slug) }),
    });
  };

  const draggedEntry = activeDragId
    ? lists.find((c) => c.slug === activeDragId)
    : null;

  return (
    <div className="screen">
      {filterActive ? (
        <ul className="list">
          {filteredLists.map((entry) => (
            <StaticListRow
              key={entry.slug}
              entry={entry}
              onSelect={() => onSelect(entry)}
              onEdit={() => openRename(entry)}
              onDelete={() => handleDelete(entry.slug)}
            />
          ))}
        </ul>
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={lists.map((c) => c.slug)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="list">
              {lists.map((entry) => (
                <SortableListRow
                  key={entry.slug}
                  entry={entry}
                  onSelect={() => onSelect(entry)}
                  onEdit={() => openRename(entry)}
                  onDelete={() => handleDelete(entry.slug)}
                />
              ))}
            </ul>
          </SortableContext>

          <DragOverlay>
            {draggedEntry ? (
              <div className="drag-overlay">
                <div className="list-item" style={{ borderBottom: "none" }}>
                  <DragHandle />
                  <div className="list-item-content">
                    <div className="list-item-title">{draggedEntry.name}</div>
                  </div>
                  <span className="cat-count">
                    {draggedEntry.done}/{draggedEntry.total}
                  </span>
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {lists.length === 0 && !creating && (
        <p style={{ padding: 16, color: "#64748b", textAlign: "center" }}>
          No todo lists yet. Tap + to create one.
        </p>
      )}

      {lists.length > 0 && filterActive && filteredLists.length === 0 && (
        <p style={{ padding: 16, color: "#64748b", textAlign: "center" }}>
          No matches.
        </p>
      )}

      {creating && (
        <div className="form">
          <input
            className="input"
            placeholder="List name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            autoFocus
          />
          {error && (
            <p style={{ color: "#f87171", fontSize: 13, margin: 0 }}>{error}</p>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn"
              onClick={handleCreate}
              disabled={!newName.trim()}
            >
              Create
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setCreating(false);
                setNewName("");
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!creating && (
        <button type="button" className="fab" onClick={() => setCreating(true)}>
          +
        </button>
      )}

      {renameList && (
        <EditTextDialog
          title="Edit list"
          placeholder="List name"
          text={renameText}
          onChange={setRenameText}
          onSave={saveRename}
          onClose={() => setRenameList(null)}
        />
      )}
    </div>
  );
}

function SortableListRow({
  entry,
  onSelect,
  onEdit,
  onDelete,
}: {
  entry: ListEntry;
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
  } = useSortable({ id: entry.slug });

  const { sliderStyle, slideHandlers, reset, handleClick } = useSwipeToReveal({
    actionCount: 2,
  });

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
              <div className="list-item-title">{entry.name}</div>
            </div>
            <span className="cat-count">
              {entry.done}/{entry.total}
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

/** Same row as sortable, without drag — used while the list is filtered (subset reorder would be ambiguous). */
function StaticListRow({
  entry,
  onSelect,
  onEdit,
  onDelete,
}: {
  entry: ListEntry;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { sliderStyle, slideHandlers, reset, handleClick } = useSwipeToReveal({
    actionCount: 2,
  });

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
              <div className="list-item-title">{entry.name}</div>
            </div>
            <span className="cat-count">
              {entry.done}/{entry.total}
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
