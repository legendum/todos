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
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  ObjectDetail,
  RenameTitle,
  type UseResourceResult,
} from "pues/base/objects";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getMarkdown,
  type ListEntry,
  saveMarkdown,
} from "../offlineDb";
import CheckIcon from "./CheckIcon";
import CopyIcon from "./CopyIcon";
import { DocHistoryRedoArrow, DocHistoryUndoArrow } from "./DocHistoryArrows";
import DragHandle from "./DragHandle";
import EditTextDialog from "./EditTextDialog";
import {
  type Line,
  markdownMemCache,
  parseLines,
  serializeLines,
} from "./lines";
import MarkdownBlock, { TodoMarkdownText } from "./MarkdownBlock";
import MarkdownSortableRow from "./MarkdownSortableRow";
import StaticTodoRow from "./StaticTodoRow";
import TodoSortableRow from "./TodoSortableRow";
import { useDocHistory } from "./useDocHistory";
import { useKeyboardSafeBottom } from "./useKeyboardSafeBottom";
import { useOnlineStatus } from "./useOnlineStatus";
import { usePageTitle } from "./usePageTitle";

type Props = {
  resource: UseResourceResult;
  list: ListEntry;
  filterQuery: string;
  onBack: () => void;
};

export default function TodoList({
  resource,
  list,
  filterQuery,
  onBack,
}: Props) {
  const [lines, setLines] = useState<Line[]>(() =>
    parseLines(markdownMemCache.get(list.slug) ?? ""),
  );
  const [newTodo, setNewTodo] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [copied, setCopied] = useState(false);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const addBarRef = useRef<HTMLDivElement>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const initialScrollSlugRef = useRef<string | null>(null);
  const pushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const online = useOnlineStatus();

  const onDocHistoryTextLoaded = useCallback(
    async (text: string, updatedAt: number) => {
      markdownMemCache.set(list.slug, text);
      setLines(parseLines(text));
      await saveMarkdown({
        slug: list.slug,
        text,
        updatedAt,
        pending: false,
      });
    },
    [list.slug],
  );

  const history = useDocHistory({
    slug: list.slug,
    online,
    onTextLoaded: onDocHistoryTextLoaded,
  });

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

  // On first non-empty render of a newly-opened list, jump to the bottom
  // so the freshest todos are in view. Guarded by slug so edits within the
  // same list don't re-snap and lose the user's scroll position.
  useEffect(() => {
    if (initialScrollSlugRef.current === list.slug) return;
    if (lines.length === 0) return;
    initialScrollSlugRef.current = list.slug;
    requestAnimationFrame(() => {
      const el = listScrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [list.slug, lines.length]);

  // Page title reflects list name and todo counts.
  const pageTitle = useMemo(() => {
    const todos = lines.filter((l) => l.isTodo);
    const done = todos.filter((l) => l.done).length;
    const total = todos.length;
    return total > 0
      ? `${list.name} (${done}/${total}) — Todos`
      : `${list.name} — Todos`;
  }, [list.name, lines]);
  usePageTitle(pageTitle);

  useKeyboardSafeBottom(addBarRef);

  // Load markdown from IndexedDB and network in parallel. IDB usually wins,
  // so rows appear immediately; network result then overwrites with fresher
  // data. A module-level in-memory cache primes `lines` synchronously on
  // revisit (see `markdownMemCache`).
  useEffect(() => {
    let cancelled = false;
    let networkLoaded = false;
    const slug = list.slug;

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
  }, [list.slug]);

  // Live updates when online
  useEffect(() => {
    if (!online) return;
    const es = new EventSource(`/w/${list.ulid}/events`);
    es.addEventListener("update", (e) => {
      const text = (e as MessageEvent<string>).data;
      void (async () => {
        const prev = await getMarkdown(list.slug);
        const t = Math.floor(Date.now() / 1000);
        await saveMarkdown({
          slug: list.slug,
          text,
          updatedAt: Math.max(prev?.updatedAt ?? 0, t),
          pending: false,
        });
        markdownMemCache.set(list.slug, text);
        setLines(parseLines(text));
      })();
    });
    return () => es.close();
  }, [list.slug, list.ulid, online]);

  useEffect(() => {
    const onSync = () => {
      void (async () => {
        const row = await getMarkdown(list.slug);
        if (row) {
          markdownMemCache.set(list.slug, row.text);
          setLines(parseLines(row.text));
        }
      })();
    };
    window.addEventListener("todos-offline-sync", onSync);
    return () => window.removeEventListener("todos-offline-sync", onSync);
  }, [list.slug]);

  /** Push current lines to server, debounced. */
  const pushToServer = useCallback(
    (updatedLines: Line[]) => {
      if (pushTimeoutRef.current) clearTimeout(pushTimeoutRef.current);
      pushTimeoutRef.current = setTimeout(() => {
        void (async () => {
          const text = serializeLines(updatedLines);
          const prev = await getMarkdown(list.slug);
          await saveMarkdown({
            slug: list.slug,
            text,
            updatedAt: prev?.updatedAt ?? 0,
            pending: true,
          });
          try {
            const res = await fetch(`/${list.slug}`, {
              method: "PUT",
              credentials: "include",
              headers: { "Content-Type": "text/markdown" },
              body: text,
            });
            if (res.ok) {
              const j = (await res.json()) as { updated_at: number };
              await saveMarkdown({
                slug: list.slug,
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
    [list.slug],
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
    navigator.clipboard.writeText(`${origin}/w/${list.ulid}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
    <ObjectDetail
      className="screen screen--detail"
      headerClassName="screen-header"
      onBack={onBack}
      backLabel="◀ Back"
      backClassName="back-btn"
      title={
        <RenameTitle
          resource={resource}
          resourceName="lists"
          rowId={list.ulid}
          label={list.name}
          className="screen-title"
        />
      }
      subtitle={
        <div
          className="webhook-url"
          title={copied ? "Copied to clipboard" : "Click to copy webhook URL"}
          onClick={copyWebhookUrl}
        >
          {list.ulid}
          {copied ? (
            <span className="copied-badge">Copied!</span>
          ) : (
            <CopyIcon />
          )}
        </div>
      }
      actions={
        <div className="header-doc-history">
          <button
            type="button"
            className="header-icon-btn"
            title="Undo last edit"
            aria-label="Undo last edit"
            disabled={!online || history.busy}
            onClick={() => void history.run("undo")}
          >
            <DocHistoryUndoArrow />
          </button>
          <button
            type="button"
            className="header-icon-btn"
            title="Redo"
            aria-label="Redo"
            disabled={!online || history.busy}
            onClick={() => void history.run("redo")}
          >
            <DocHistoryRedoArrow />
          </button>
        </div>
      }
    >
      {history.error ? (
        <div className="history-error-banner" role="status">
          {history.error}
        </div>
      ) : null}

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
    </ObjectDetail>
  );
}
