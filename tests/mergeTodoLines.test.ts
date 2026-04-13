import { describe, expect, test } from "bun:test";
import { mergeTodoLines } from "../src/lib/mergeTodoLines";

describe("mergeTodoLines", () => {
  test("reorders only todos; free-form lines stay in place", () => {
    const lines = [
      { id: "a", isTodo: false as const, text: "## H" },
      { id: "b", isTodo: true as const, text: "t1" },
      { id: "c", isTodo: false as const, text: "note" },
      { id: "d", isTodo: true as const, text: "t2" },
    ];
    const next = mergeTodoLines(lines, "d", "b");
    expect(next.map((l) => l.id)).toEqual(["a", "d", "c", "b"]);
  });

  test("no-op when ids missing", () => {
    const lines = [
      { id: "a", isTodo: false as const, text: "x" },
      { id: "b", isTodo: true as const, text: "t" },
    ];
    expect(mergeTodoLines(lines, "missing", "b")).toEqual(lines);
  });

  test("single todo unchanged when dragged to self", () => {
    const lines = [
      { id: "a", isTodo: false as const, text: "md" },
      { id: "b", isTodo: true as const, text: "only" },
    ];
    expect(mergeTodoLines(lines, "b", "b")).toEqual(lines);
  });
});
