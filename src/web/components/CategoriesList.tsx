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
import { useCallback, useEffect, useState } from "react";
import DragHandle from "./DragHandle";
import { useSwipeToReveal } from "./useSwipeToReveal";

type Category = {
  name: string;
  slug: string;
  ulid: string;
  position: number;
  total: number;
  done: number;
};

type Props = {
  onSelect: (cat: Category) => void;
};

export default function CategoriesList({ onSelect }: Props) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { distance: 6 } }),
  );

  const fetchCategories = useCallback(async () => {
    const res = await fetch("/", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return;
    const data = (await res.json()) as { categories: Category[] };
    setCategories(data.categories);
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

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
      setError(data.message || "Failed to create category");
      return;
    }
    setNewName("");
    setCreating(false);
    await fetchCategories();
  };

  const handleDelete = async (slug: string) => {
    await fetch(`/${slug}`, { method: "DELETE", credentials: "include" });
    await fetchCategories();
  };

  function handleDragStart(event: DragStartEvent) {
    setActiveDragId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    const oldIndex = categories.findIndex((c) => c.slug === activeId);
    const newIndex = categories.findIndex((c) => c.slug === overId);
    if (oldIndex < 0 || newIndex < 0) return;

    const next = arrayMove(categories, oldIndex, newIndex);
    setCategories(next);

    fetch("/t/reorder", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: next.map((c) => c.slug) }),
    });
  }

  const draggedCat = activeDragId
    ? categories.find((c) => c.slug === activeDragId)
    : null;

  return (
    <div className="screen">
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={categories.map((c) => c.slug)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="list">
            {categories.map((cat) => (
              <CategoryRow
                key={cat.slug}
                category={cat}
                onSelect={() => onSelect(cat)}
                onDelete={() => handleDelete(cat.slug)}
              />
            ))}
          </ul>
        </SortableContext>

        <DragOverlay>
          {draggedCat ? (
            <div className="drag-overlay">
              <div className="list-item" style={{ borderBottom: "none" }}>
                <DragHandle />
                <div className="list-item-content">
                  <div className="list-item-title">{draggedCat.name}</div>
                </div>
                <span className="cat-count">
                  {draggedCat.done}/{draggedCat.total}
                </span>
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {categories.length === 0 && !creating && (
        <p style={{ padding: 16, color: "#64748b", textAlign: "center" }}>
          No categories yet. Tap + to create one.
        </p>
      )}

      {creating && (
        <div className="form">
          <input
            className="input"
            placeholder="Category name"
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
              className="btn"
              onClick={handleCreate}
              disabled={!newName.trim()}
            >
              Create
            </button>
            <button
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
        <button className="fab" onClick={() => setCreating(true)}>
          +
        </button>
      )}
    </div>
  );
}

function CategoryRow({
  category,
  onSelect,
  onDelete,
}: {
  category: Category;
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
  } = useSortable({ id: category.slug });

  const { sliderStyle, slideHandlers } = useSwipeToReveal({ onTap: onSelect });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <li className="row-wrap" ref={setNodeRef} style={style} {...attributes}>
      <div className="row-slider" style={sliderStyle} {...slideHandlers}>
        <div className="row-main">
          <div className="list-item" style={{ borderBottom: "none" }}>
            <DragHandle listeners={listeners} />
            <div className="list-item-content" style={{ marginLeft: 8 }}>
              <div className="list-item-title">{category.name}</div>
            </div>
            <span className="cat-count">
              {category.done}/{category.total}
            </span>
          </div>
        </div>
        <button className="row-delete" onClick={onDelete}>
          Delete
        </button>
      </div>
    </li>
  );
}
