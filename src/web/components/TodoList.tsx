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
import type { ParsedLine, TodoListMarker } from "../../lib/todos";
import {
  mergeConsecutiveFreeformLines,
  parseContent,
  serializeContent,
} from "../../lib/todos";
import {
  type CategoryListEntry,
  deleteMarkdown,
  getMarkdown,
  saveMarkdown,
} from "../offlineDb";
import { patchCategoryName } from "../patchCategoryName";
import DragHandle from "./DragHandle";
import EditTextDialog from "./EditTextDialog";
import MarkdownBlock from "./MarkdownBlock";
import { useSwipeToReveal } from "./useSwipeToReveal";

/** Client row for DnD + editing; mirrors `ParsedLine` without invalid `raw` on todos. */
type Line =
  | {
      id: string;
      isTodo: true;
      done: boolean;
      text: string;
      indent?: string;
      listMarker?: TodoListMarker;
    }
  | { id: string; isTodo: false; text: string };

function parseLines(content: string): Line[] {
  if (!content) return [];
  return mergeConsecutiveFreeformLines(parseContent(content)).map((p, i) => {
    const id = `line-${i}`;
    if (p.isTodo) {
      const t = p.todo;
      return {
        id,
        isTodo: true,
        done: t.done,
        text: t.text,
        indent: t.indent,
        listMarker: t.listMarker,
      };
    }
    return { id, isTodo: false, text: p.raw };
  });
}

function serializeLines(lines: Line[]): string {
  const mapped: ParsedLine[] = lines.map((l) =>
    l.isTodo
      ? {
          isTodo: true,
          todo: {
            done: l.done,
            text: l.text,
            indent: l.indent,
            listMarker: l.listMarker,
          },
        }
      : { isTodo: false, raw: l.text },
  );
  return serializeContent(mapped);
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
  category: CategoryListEntry;
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
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [syncPending, setSyncPending] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { distance: 6 } }),
  );

  useEffect(() => {
    if (!editingName) setEditName(category.name);
  }, [category.name, category.slug, editingName]);

  // Update page title with category name and counts
  useEffect(() => {
    const todos = lines.filter((l) => l.isTodo);
    const done = todos.filter((l) => l.done).length;
    const total = todos.length;
    document.title =
      total > 0
        ? `${category.name} (${done}/${total}) — Todos`
        : `${category.name} — Todos`;
    return () => {
      document.title = "Todos";
    };
  }, [category.name, lines]);

  const refreshPendingUi = useCallback(async () => {
    const row = await getMarkdown(category.slug);
    setSyncPending(Boolean(row?.pending));
  }, [category.slug]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // Load markdown from network or IndexedDB cache
  useEffect(() => {
    let cancelled = false;
    const slug = category.slug;

    void (async () => {
      try {
        const res = await fetch(`/${slug}.md`, { credentials: "include" });
        if (!res.ok) throw new Error(String(res.status));
        const text = await res.text();
        const h = res.headers.get("X-Updated-At");
        const updatedAt = h ? parseInt(h, 10) : 0;
        await saveMarkdown({ slug, text, updatedAt, pending: false });
        if (!cancelled) setLines(parseLines(text));
      } catch {
        const cached = await getMarkdown(slug);
        if (cached) {
          if (!cancelled) setLines(parseLines(cached.text));
        } else if (!cancelled) {
          setLines([]);
        }
      }
      if (!cancelled) void refreshPendingUi();
    })();

    return () => {
      cancelled = true;
    };
  }, [category.slug, refreshPendingUi]);

  // Live updates when online
  useEffect(() => {
    if (!online) return;
    const es = new EventSource(`/w/${category.ulid}/events`);
    es.addEventListener("update", (e) => {
      const text = (e as MessageEvent<string>).data;
      void (async () => {
        const prev = await getMarkdown(category.slug);
        const t = Math.floor(Date.now() / 1000);
        await saveMarkdown({
          slug: category.slug,
          text,
          updatedAt: Math.max(prev?.updatedAt ?? 0, t),
          pending: false,
        });
        setLines(parseLines(text));
      })();
    });
    return () => es.close();
  }, [category.slug, category.ulid, online]);

  useEffect(() => {
    const onSync = () => {
      void (async () => {
        const row = await getMarkdown(category.slug);
        if (row) setLines(parseLines(row.text));
        await refreshPendingUi();
      })();
    };
    window.addEventListener("todos-offline-sync", onSync);
    return () => window.removeEventListener("todos-offline-sync", onSync);
  }, [category.slug, refreshPendingUi]);

  /** Push current lines to server, debounced. */
  const pushToServer = useCallback(
    (updatedLines: Line[]) => {
      if (pushTimeoutRef.current) clearTimeout(pushTimeoutRef.current);
      pushTimeoutRef.current = setTimeout(() => {
        void (async () => {
          const text = serializeLines(updatedLines);
          const prev = await getMarkdown(category.slug);
          await saveMarkdown({
            slug: category.slug,
            text,
            updatedAt: prev?.updatedAt ?? 0,
            pending: true,
          });
          await refreshPendingUi();
          try {
            const res = await fetch(`/${category.slug}`, {
              method: "PUT",
              credentials: "include",
              headers: { "Content-Type": "text/markdown" },
              body: text,
            });
            if (res.ok) {
              const j = (await res.json()) as { updated_at: number };
              await saveMarkdown({
                slug: category.slug,
                text,
                updatedAt: j.updated_at,
                pending: false,
              });
            }
          } catch {
            /* pending stays true */
          } finally {
            await refreshPendingUi();
          }
        })();
      }, 300);
    },
    [category.slug, refreshPendingUi],
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
      prev.map((l, i) => {
        if (i !== index || !l.isTodo) return l;
        return { ...l, done: !l.done };
      }),
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
      {
        id: `line-${Date.now()}`,
        isTodo: true,
        done: false,
        text,
      },
    ]);
  };

  const openEditDialog = (index: number) => {
    const row = lines[index];
    if (!row?.isTodo) return;
    setEditingIndex(index);
    setEditText(row.text);
  };

  const saveEdit = () => {
    if (editingIndex === null) return;
    const row = lines[editingIndex];
    if (!row?.isTodo) {
      setEditingIndex(null);
      return;
    }
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
    if (!navigator.onLine) {
      cancelEditName();
      return;
    }
    const oldSlug = category.slug;
    const data = await patchCategoryName(oldSlug, trimmed);
    if (data) {
      if (data.slug !== oldSlug) {
        const row = await getMarkdown(oldSlug);
        if (row) {
          await saveMarkdown({ ...row, slug: data.slug });
          await deleteMarkdown(oldSlug);
        }
      }
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

  const draggedLine = activeDragId
    ? lines.find((l) => l.id === activeDragId)
    : null;

  return (
    <div
      className="screen"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        paddingBottom: 0,
      }}
    >
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
              title="Click to rename category"
              onClick={startEditingName}
              style={{ cursor: "pointer" }}
            >
              {category.name}
            </h2>
          )}
          <div
            className="webhook-url"
            title={copied ? "Copied to clipboard" : "Click to copy webhook URL"}
            onClick={copyWebhookUrl}
          >
            /w/{category.ulid}
            {copied ? (
              <span className="copied-badge">Copied!</span>
            ) : (
              <CopyIcon />
            )}
          </div>
        </div>
      </div>

      {(!online || syncPending) && (
        <div className="offline-banner">
          {!online
            ? "You're offline — edits stay on this device and sync when you're back online."
            : "Saving changes to the server…"}
        </div>
      )}

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
            {lines.map((line, index) =>
              line.isTodo ? (
                <TodoSortableRow
                  key={line.id}
                  line={line}
                  onToggle={() => toggleDone(index)}
                  onDelete={() => deleteLine(index)}
                  onEdit={() => openEditDialog(index)}
                />
              ) : (
                <MarkdownSortableRow key={line.id} line={line} />
              ),
            )}
          </SortableContext>

          <DragOverlay>
            {draggedLine ? (
              <div className="drag-overlay">
                {draggedLine.isTodo ? (
                  <div className="todo-row">
                    <DragHandle />
                    <button
                      className={`todo-checkbox${draggedLine.done ? " checked" : ""}`}
                      type="button"
                    >
                      {draggedLine.done && <CheckIcon />}
                    </button>
                    <span
                      className={`todo-text${draggedLine.done ? " done" : ""}`}
                    >
                      <TextWithLinks text={draggedLine.text} />
                    </span>
                  </div>
                ) : (
                  <div
                    className="md-sortable-inner"
                    style={{ maxWidth: "100%" }}
                  >
                    <DragHandle />
                    <MarkdownBlock text={draggedLine.text} />
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
        <EditTextDialog
          title="Edit todo"
          text={editText}
          onChange={setEditText}
          onSave={saveEdit}
          onClose={() => setEditingIndex(null)}
        />
      )}
    </div>
  );
}

/** Free-form line: whole row is draggable; markdown is read-only (no swipe edit/delete). */
function MarkdownSortableRow({
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

function TodoSortableRow({
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
        <TextWithLinks text={line.text} />
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

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 7l3.5 3.5L12 3" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="5" y="5" width="9" height="9" rx="1.5" />
      <path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5" />
    </svg>
  );
}
