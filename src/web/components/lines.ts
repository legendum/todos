import type { ParsedLine, TodoListMarker } from "../../lib/todos";
import {
  mergeConsecutiveFreeformLines,
  parseContent,
  serializeContent,
} from "../../lib/todos";

/** Client row for DnD + editing; mirrors `ParsedLine` without invalid `raw` on todos. */
export type Line =
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
 * In-memory cache of the last-seen markdown per list, keyed by slug.
 * Used to prime `lines` synchronously when the user re-opens a list
 * they've already visited this session, so the rows area doesn't flash
 * blank while IndexedDB and the network fetch resolve.
 */
export const markdownMemCache = new Map<string, string>();

export function parseLines(content: string): Line[] {
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

export function serializeLines(lines: Line[]): string {
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
