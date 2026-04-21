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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import CopyIcon from "./CopyIcon";
import DragHandle from "./DragHandle";
import EditTextDialog from "./EditTextDialog";
import MarkdownBlock, { TodoMarkdownText } from "./MarkdownBlock";
import ShareIcon from "./ShareIcon";
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

/**
 * In-memory cache of the last-seen markdown per category, keyed by slug.
 * Used to prime `lines` synchronously when the user re-opens a category
 * they've already visited this session, so the rows area doesn't flash
 * blank while IndexedDB and the network fetch resolve.
 */
const markdownMemCache = new Map<string, string>();

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

type Props = {
  category: CategoryListEntry;
  filterQuery: string;
  onBack: () => void;
  onRenamed: (updated: { name: string; slug: string }) => void;
};

export default function TodoList({
  category,
  filterQuery,
  onBack,
  onRenamed,
}: Props) {
  const [lines, setLines] = useState<Line[]>(() =>
    parseLines(markdownMemCache.get(category.slug) ?? ""),
  );
  const [newTodo, setNewTodo] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [copied, setCopied] = useState(false);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [editName, setEditName] = useState(category.name);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const addBarRef = useRef<HTMLDivElement>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const initialScrollSlugRef = useRef<string | null>(null);
  const pushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { distance: 6 } }),
  );

  const filterTrim = filterQuery.trim().toLowerCase();
  const filterActive = filterTrim.length > 0;
  const visibleLines = useMemo(() => {
    if (!filterActive) return lines.map((line, index) => ({ line, index }));
    return lines
      .map((line, index) => ({ line, index }))
      .filter(
        ({ line }) =>
          line.isTodo && line.text.toLowerCase().includes(filterTrim),
      );
  }, [lines, filterActive, filterTrim]);

  useEffect(() => {
    if (!editingName) setEditName(category.name);
  }, [category.name, category.slug, editingName]);

  // On first non-empty render of a newly-opened category, jump to the bottom
  // so the freshest todos are in view. Guarded by slug so edits within the
  // same list don't re-snap and lose the user's scroll position.
  useEffect(() => {
    if (initialScrollSlugRef.current === category.slug) return;
    if (lines.length === 0) return;
    initialScrollSlugRef.current = category.slug;
    requestAnimationFrame(() => {
      const el = listScrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [category.slug, lines.length]);

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

  // Pin the add-todo bar to the bottom of the *visual* viewport so it floats
  // just above the mobile keyboard instead of getting pushed off-screen.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const el = addBarRef.current;
      if (!el) return;
      const offset = window.innerHeight - vv.offsetTop - vv.height;
      el.style.bottom = `${Math.max(0, offset)}px`;
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  // Load markdown from IndexedDB and network in parallel. IDB usually wins,
  // so rows appear immediately; network result then overwrites with fresher
  // data. A module-level in-memory cache primes `lines` synchronously on
  // revisit (see `markdownMemCache`).
  useEffect(() => {
    let cancelled = false;
    let networkLoaded = false;
    const slug = category.slug;

    void (async () => {
      const cached = await getMarkdown(slug);
      if (cancelled || networkLoaded || !cached) return;
      markdownMemCache.set(slug, cached.text);
      setLines(parseLines(cached.text));
    })();

    void (async () => {
      try {
        const res = await fetch(`/${slug}.md`, { credentials: "include" });
        if (!res.ok) throw new Error(String(res.status));
        const text = await res.text();
        const h = res.headers.get("X-Updated-At");
        const updatedAt = h ? parseInt(h, 10) : 0;
        await saveMarkdown({ slug, text, updatedAt, pending: false });
        if (cancelled) return;
        networkLoaded = true;
        markdownMemCache.set(slug, text);
        setLines(parseLines(text));
      } catch {
        /* cache path above handles the fallback */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [category.slug]);

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
        markdownMemCache.set(category.slug, text);
        setLines(parseLines(text));
      })();
    });
    return () => es.close();
  }, [category.slug, category.ulid, online]);

  useEffect(() => {
    const onSync = () => {
      void (async () => {
        const row = await getMarkdown(category.slug);
        if (row) {
          markdownMemCache.set(category.slug, row.text);
          setLines(parseLines(row.text));
        }
      })();
    };
    window.addEventListener("todos-offline-sync", onSync);
    return () => window.removeEventListener("todos-offline-sync", onSync);
  }, [category.slug]);

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
          }
        })();
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

  const shareMarkdown = useCallback(async () => {
    const text = serializeLines(lines);
    const safeSlug = category.slug.replace(/[^\w.-]+/g, "_") || "todos";
    const filename = `${safeSlug}.md`;
    const file = new File([text], filename, { type: "text/markdown" });

    const userCancelledShare = (e: unknown) =>
      e instanceof DOMException && e.name === "AbortError";

    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: category.name });
        return;
      } catch (e) {
        if (userCancelledShare(e)) return;
      }
    }

    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: `${category.name} — todos`,
          text,
        });
        return;
      } catch (e) {
        if (userCancelledShare(e)) return;
      }
    }

    const url = URL.createObjectURL(
      new Blob([text], { type: "text/markdown;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2500);
  }, [lines, category.name, category.slug]);

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
    // Scroll to the new row after React paints it.
    requestAnimationFrame(() => {
      const el = listScrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
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

    setLines((prev) => {
      const oldIndex = prev.findIndex((l) => l.id === activeId);
      const newIndex = prev.findIndex((l) => l.id === overId);
      if (oldIndex < 0 || newIndex < 0) return prev;
      const next = arrayMove(prev, oldIndex, newIndex);
      pushToServer(next);
      return next;
    });
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
        <button
          type="button"
          className="header-icon-btn"
          title="Share or export markdown"
          aria-label="Share or export markdown"
          onClick={() => void shareMarkdown()}
        >
          <ShareIcon />
        </button>
      </div>

      {!online && (
        <div className="offline-banner">
          You're offline — edits stay on this device and sync when you're back
          online.
        </div>
      )}

      <div
        ref={listScrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          paddingBottom: filterActive ? 0 : 72,
        }}
      >
        {filterActive ? (
          visibleLines.length > 0 ? (
            visibleLines.map(({ line, index }) =>
              line.isTodo ? (
                <StaticTodoRow
                  key={line.id}
                  line={line}
                  onToggle={() => toggleDone(index)}
                  onDelete={() => deleteLine(index)}
                  onEdit={() => openEditDialog(index)}
                />
              ) : null,
            )
          ) : (
            <p style={{ padding: 16, color: "#64748b", textAlign: "center" }}>
              No matches.
            </p>
          )
        ) : (
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
                        <TodoMarkdownText text={draggedLine.text} />
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
        )}

        {!filterActive && lines.length === 0 && (
          <p style={{ padding: 16, color: "#64748b", textAlign: "center" }}>
            No todo items yet. Tap Add to create one.
          </p>
        )}
      </div>

      {!filterActive && (
        <div className="add-todo-bar" ref={addBarRef}>
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
      )}

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

/** Non-draggable todo row used while a filter is active — reordering a filtered
 * subset would silently rearrange hidden neighbours, so drag is disabled. */
function StaticTodoRow({
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
