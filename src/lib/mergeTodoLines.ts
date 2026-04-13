import { arrayMove } from "@dnd-kit/sortable";

/**
 * Reorder todo lines among themselves; free-form lines stay fixed at their indices.
 * Used when the document mixes markdown prose with task items.
 */
export function mergeTodoLines<T extends { isTodo: boolean; id: string }>(
  lines: T[],
  activeId: string,
  overId: string,
): T[] {
  const todoLines = lines.filter((l) => l.isTodo);
  const oldIndex = todoLines.findIndex((l) => l.id === activeId);
  const newIndex = todoLines.findIndex((l) => l.id === overId);
  if (oldIndex < 0 || newIndex < 0) return lines;
  const reordered = arrayMove(todoLines, oldIndex, newIndex);
  let ti = 0;
  return lines.map((l) => (l.isTodo ? reordered[ti++] : l));
}
