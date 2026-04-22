import type { ListEntry } from "./offlineDb";

/** Response body from `GET /:slug.json`. */
export type TodoListJson = {
  name: string;
  slug: string;
  ulid: string;
  total?: number;
  done?: number;
  updated_at?: number;
};

/** Map into list row shape (position comes from list API when available). */
export function listFromTodoJson(data: TodoListJson): ListEntry {
  return {
    name: data.name,
    slug: data.slug,
    ulid: data.ulid,
    position: 0,
    total: data.total ?? 0,
    done: data.done ?? 0,
    updated_at: data.updated_at ?? 0,
  };
}
