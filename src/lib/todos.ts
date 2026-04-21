/** Line must stay in sync with `parseContent` todo detection. */
const TODO_LINE_RE = /^(\s*)(?:(-|\*|\+|\d+\.)\s)?\[([ xX])\]\s*(.*)$/;

/** Drop every done (`[x]`) todo line; free-form text lines are preserved. */
export function purgeDoneTodos(lines: ParsedLine[]): ParsedLine[] {
  return lines.filter((l) => !(l.isTodo && l.todo.done));
}

/** Count todo lines in a todos.md document. */
export function countTodos(text: string): { total: number; done: number } {
  let total = 0;
  let done = 0;
  for (const p of parseContent(text)) {
    if (p.isTodo) {
      total++;
      if (p.todo.done) done++;
    }
  }
  return { total, done };
}

/** Validate a todos.md document against limits. Returns null if valid, or an error message. */
export function validateTodosText(
  text: string,
  selfHosted: boolean,
): string | null {
  if (selfHosted) return null;

  const bytes = new TextEncoder().encode(text).length;
  if (bytes > 10240) {
    return "Document exceeds 10 KB limit";
  }

  const { total } = countTodos(text);
  if (total > 200) {
    return "Document exceeds 200 todo limit";
  }

  return null;
}

/** Derive a URL-safe slug from a display name. */
export function toSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-") // spaces and underscores → hyphens
    .replace(/[^a-z0-9.-]/g, "") // strip anything else
    .replace(/-+/g, "-") // collapse multiple hyphens
    .replace(/^-|-$/g, ""); // trim leading/trailing hyphens
}

/** Reserved slugs that cannot be used. */
const RESERVED_SLUGS = new Set(["t", "w"]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}

/** Validate a category name. Returns null if valid, or an error message. */
export function validateCategoryName(name: string): string | null {
  if (!name || name.trim().length === 0) return "Name is required";
  if (name.length > 100) return "Name is too long";
  const slug = toSlug(name);
  if (!slug) return "Name must contain at least one letter or number";
  if (isReservedSlug(slug)) return `"${name}" is a reserved name`;
  return null;
}

/** Optional list marker before `[ ]` / `[x]` (e.g. `- [ ] task` or `1. [ ] task`). */
export type TodoListMarker = "-" | "*" | "+" | `${number}.`;

export interface TodoLine {
  done: boolean;
  text: string;
  indent?: string;
  /** Preserved on round-trip; omit for plain `[ ]` lines. */
  listMarker?: TodoListMarker;
}

export type ParsedLine =
  | { isTodo: true; todo: TodoLine }
  | { isTodo: false; raw: string };

export function parseContent(content: string): ParsedLine[] {
  const trimmed = content.endsWith("\n") ? content.slice(0, -1) : content;
  if (!trimmed) return [];
  return trimmed.split("\n").map((line) => {
    const match = line.match(TODO_LINE_RE);
    if (match) {
      const indent = match[1];
      const listMarker = match[2] as TodoListMarker | undefined;
      const done = match[3].toLowerCase() === "x";
      const text = match[4];
      const todo: TodoLine = { done, text, indent };
      if (listMarker) todo.listMarker = listMarker;
      return { isTodo: true, todo };
    }
    return { isTodo: false, raw: line };
  });
}

/**
 * Merge each run of consecutive non-todo lines into one free-form block (`raw` joined by `\n`).
 * Used by the web UI so intro / notes are one draggable unit; todos stay separate rows.
 */
export function mergeConsecutiveFreeformLines(
  lines: ParsedLine[],
): ParsedLine[] {
  const out: ParsedLine[] = [];
  const buf: string[] = [];
  const flush = () => {
    if (buf.length) {
      out.push({ isTodo: false, raw: buf.join("\n") });
      buf.length = 0;
    }
  };
  for (const p of lines) {
    if (p.isTodo) {
      flush();
      out.push(p);
    } else {
      buf.push(p.raw);
    }
  }
  flush();
  return out;
}

export function serializeContent(lines: ParsedLine[]): string {
  if (lines.length === 0) return "";
  const parts = lines.map((l) => {
    if (l.isTodo) {
      const t = l.todo;
      const indent = t.indent || "";
      const mid = t.listMarker ? `${t.listMarker} ` : "";
      const box = t.done ? "[x]" : "[ ]";
      return `${indent}${mid}${box} ${t.text}`;
    }
    return l.raw;
  });
  return `${parts.join("\n")}\n`;
}
