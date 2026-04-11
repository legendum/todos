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
import { useCallback, useEffect, useRef, useState } from "react";
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

/** A parsed line: either a todo or free-form text. */
type Line = {
  id: string; // stable key for DnD
  raw: string;
  isTodo: boolean;
  done: boolean;
  text: string; // For todos: text after `[ ] ` or `[x] `. For free-form: the raw line.
};

function parseLines(content: string): Line[] {
  if (!content) return [];
  const trimmed = content.endsWith("\n") ? content.slice(0, -1) : content;
  if (!trimmed) return [];
  return trimmed.split("\n").map((raw, i) => {
    if (raw.startsWith("[ ] ")) {
      return { id: `line-${i}`, raw, isTodo: true, done: false, text: raw.slice(4) };
    }
    if (raw.startsWith("[x] ")) {
      return { id: `line-${i}`, raw, isTodo: true, done: true, text: raw.slice(4) };
    }
    return { id: `line-${i}`, raw, isTodo: false, done: false, text: raw };
  });
}

function serializeLines(lines: Line[]): string {
  if (lines.length === 0) return "";
  return lines
    .map((l) => {
      if (l.isTodo) return `${l.done ? "[x]" : "[ ]"} ${l.text}`;
      return l.raw;
    })
    .join("\n") + "\n";
}

/** Split on http(s) URLs and render anchors that open in a new tab. */
const URL_IN_TEXT = /(https?:\/\/[^\s]+)/g;

function TextWithLinks({ text }: { text: string }) {
  const parts = text.split(URL_IN_TEXT);
  return (
    <span className="text-with-links">
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-inline-link"
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </span>
  );
}

type Props = {
  category: Category;
  onBack: () => void;
  onRenamed: (updated: { name: string; slug: string }) => void;
};

export default function TodoList({ category, onBack, onRenamed }: Props) {
  const [lines, setLines] = useState<Line[]>([]);
  const [newTodo, setNewTodo] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [copied, setCopied] = useState(false);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [editName, setEditName] = useState(category.name);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const pushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { distance: 6 } }),
  );

  // Update page title with category name and counts
  useEffect(() => {
    const todos = lines.filter((l) => l.isTodo);
    const done = todos.filter((l) => l.done).length;
    const total = todos.length;
    document.title = total > 0
      ? `${category.name} (${done}/${total}) — Todos`
      : `${category.name} — Todos`;
    return () => { document.title = "Todos"; };
  }, [category.name, lines]);

  // Fetch initial content and start SSE
  useEffect(() => {
    fetch(`/${category.slug}.txt`, { credentials: "include" })
      .then((r) => r.text())
      .then((text) => setLines(parseLines(text)))
      .catch(() => {});

    const es = new EventSource(`/w/${category.ulid}/events`);
    es.addEventListener("update", (e) => setLines(parseLines(e.data)));
    return () => es.close();
  }, [category.slug, category.ulid]);

  /** Push current lines to server, debounced. */
  const pushToServer = useCallback(
    (updatedLines: Line[]) => {
      if (pushTimeoutRef.current) clearTimeout(pushTimeoutRef.current);
      pushTimeoutRef.current = setTimeout(() => {
        const text = serializeLines(updatedLines);
        fetch(`/${category.slug}`, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "text/plain" },
          body: text,
        });
      }, 300);
    },
    [category.slug],
  );

  const updateLines = useCallback(
    (fn: (prev: Line[]) => Line[]) => {
      setLines((prev) => {
        const next = fn(prev);
        pushToServer(next);
        return next;
      });
    },
    [pushToServer],
  );

  const toggleDone = (index: number) => {
    updateLines((prev) =>
      prev.map((l, i) => (i === index ? { ...l, done: !l.done } : l)),
    );
  };

  const deleteLine = (index: number) => {
    updateLines((prev) => prev.filter((_, i) => i !== index));
  };

  const addTodo = () => {
    const text = newTodo.trim();
    if (!text) return;
    setNewTodo("");
    updateLines((prev) => [
      ...prev,
      { id: `line-${Date.now()}`, raw: `[ ] ${text}`, isTodo: true, done: false, text },
    ]);
  };

  const openEditDialog = (index: number) => {
    setEditingIndex(index);
    setEditText(lines[index].text);
  };

  const saveEdit = () => {
    if (editingIndex === null) return;
    const trimmed = editText.trim();
    if (!trimmed) {
      deleteLine(editingIndex);
    } else {
      const idx = editingIndex;
      updateLines((prev) =>
        prev.map((l, i) => (i === idx ? { ...l, text: trimmed } : l)),
      );
    }
    setEditingIndex(null);
  };

  const copyWebhookUrl = () => {
    const origin = window.location.origin;
    navigator.clipboard.writeText(`${origin}/w/${category.ulid}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const startEditingName = () => {
    setEditName(category.name);
    setEditingName(true);
  };

  const saveName = async () => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === category.name) {
      setEditingName(false);
      return;
    }
    const res = await fetch(`/${category.slug}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    if (res.ok) {
      const data = (await res.json()) as { name: string; slug: string };
      setEditingName(false);
      onRenamed(data);
    }
  };

  const cancelEditName = () => setEditingName(false);

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

    const oldIndex = lines.findIndex((l) => l.id === activeId);
    const newIndex = lines.findIndex((l) => l.id === overId);
    if (oldIndex < 0 || newIndex < 0) return;

    const next = arrayMove(lines, oldIndex, newIndex);
    setLines(next);
    pushToServer(next);
  }

  const draggedLine = activeDragId ? lines.find((l) => l.id === activeDragId) : null;

  return (
    <div className="screen" style={{ display: "flex", flexDirection: "column", height: "100%", paddingBottom: 0 }}>
      <div className="screen-header">
        <button className="back-btn" onClick={onBack}>
          &#8592; Back
        </button>
        <div className="screen-header-text">
          {editingName ? (
            <input
              ref={nameInputRef}
              type="text"
              className="screen-title"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                } else if (e.key === "Escape") {
                  cancelEditName();
                  nameInputRef.current?.blur();
                }
              }}
              autoFocus
              style={{
                display: "block",
                width: "100%",
                margin: 0,
                padding: 0,
                border: "1px solid #475569",
                borderRadius: 4,
                background: "#1e293b",
                color: "inherit",
                font: "inherit",
              }}
            />
          ) : (
            <h2
              className="screen-title"
              onClick={startEditingName}
              style={{ cursor: "pointer" }}
            >
              {category.name}
            </h2>
          )}
          <div className="webhook-url" onClick={copyWebhookUrl}>
            /w/{category.ulid}
            {copied ? (
              <span className="copied-badge">Copied!</span>
            ) : (
              <CopyIcon />
            )}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={lines.map((l) => l.id)}
            strategy={verticalListSortingStrategy}
          >
            {lines.map((line, index) => (
              <SortableLine
                key={line.id}
                line={line}
                onToggle={() => toggleDone(index)}
                onDelete={() => deleteLine(index)}
                onEdit={() => openEditDialog(index)}
              />
            ))}
          </SortableContext>

          <DragOverlay>
            {draggedLine ? (
              <div className="drag-overlay">
                {draggedLine.isTodo ? (
                  <div className="todo-row">
                    <DragHandle />
                    <button className={`todo-checkbox${draggedLine.done ? " checked" : ""}`}>
                      {draggedLine.done && <CheckIcon />}
                    </button>
                    <span className={`todo-text${draggedLine.done ? " done" : ""}`}>
                      <TextWithLinks text={draggedLine.text} />
                    </span>
                  </div>
                ) : (
                  <div className="freeform-line">
                    <TextWithLinks text={draggedLine.text} />
                  </div>
                )}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      <div className="add-todo-bar">
        <input
          className="input"
          placeholder="Add a todo..."
          value={newTodo}
          onChange={(e) => setNewTodo(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTodo()}
        />
        <button className="btn" onClick={addTodo} disabled={!newTodo.trim()}>
          Add
        </button>
      </div>

      {editingIndex !== null && (
        <EditDialog
          text={editText}
          onChange={setEditText}
          onSave={saveEdit}
          onClose={() => setEditingIndex(null)}
        />
      )}
    </div>
  );
}

function EditDialog({ text, onChange, onSave, onClose }: {
  text: string;
  onChange: (text: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2 style={{ margin: 0, fontSize: 18 }}>Edit todo</h2>
          <button className="dialog-close" onClick={onClose}>&times;</button>
        </div>
        <div className="dialog-body">
          <input
            ref={inputRef}
            className="input"
            value={text}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onSave(); }}
            style={{ width: "100%" }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
            <button className="btn" style={{ background: "#334155" }} onClick={onClose}>Cancel</button>
            <button className="btn" onClick={onSave}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SortableLine({
  line,
  onToggle,
  onDelete,
  onEdit,
}: {
  line: Line;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: line.id });
  const { sliderStyle, slideHandlers, reset } = useSwipeToReveal({ actionCount: 2 });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const content = line.isTodo ? (
    <div className="todo-row">
      <DragHandle listeners={listeners} />
      <button
        className={`todo-checkbox${line.done ? " checked" : ""}`}
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
      >
        {line.done && <CheckIcon />}
      </button>
      <span className={`todo-text${line.done ? " done" : ""}`}>
        <TextWithLinks text={line.text} />
      </span>
    </div>
  ) : (
    <div className="freeform-line" style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <DragHandle listeners={listeners} />
      <span>{line.text ? <TextWithLinks text={line.text} /> : "\u00A0"}</span>
    </div>
  );

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <div className="row-wrap" style={{ borderBottom: "none" }}>
        <div className="row-slider" style={sliderStyle} {...slideHandlers}>
          <div className="row-main">{content}</div>
          <button className="row-edit" onClick={() => { reset(); onEdit(); }}>Edit</button>
          <button className="row-delete" onClick={onDelete}>Delete</button>
        </div>
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 7l3.5 3.5L12 3" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="5" y="5" width="9" height="9" rx="1.5" />
      <path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5" />
    </svg>
  );
}
