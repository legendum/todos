import { describe, expect, test } from "bun:test";
import {
  countTodos,
  mergeConsecutiveFreeformLines,
  parseContent,
  serializeContent,
  toSlug,
  validateCategoryName,
  validateTodosText,
} from "../src/lib/todos";

describe("countTodos", () => {
  test("counts todos and done items", () => {
    const text = `[ ] Buy milk
[x] Fix bug
[ ] Deploy`;
    expect(countTodos(text)).toEqual({ total: 3, done: 1 });
  });

  test("ignores free-form text", () => {
    const text = `## Sprint 3
Context: shipping by Friday

[ ] Buy milk
[x] Fix bug

## Backlog
[ ] Refactor`;
    expect(countTodos(text)).toEqual({ total: 3, done: 1 });
  });

  test("empty text", () => {
    expect(countTodos("")).toEqual({ total: 0, done: 0 });
  });

  test("all done", () => {
    const text = `[x] A
[x] B`;
    expect(countTodos(text)).toEqual({ total: 2, done: 2 });
  });

  test("no todos, only free-form text", () => {
    const text = `## Notes
Just some random text
Another line`;
    expect(countTodos(text)).toEqual({ total: 0, done: 0 });
  });
});

describe("mergeConsecutiveFreeformLines", () => {
  test("merges intro lines into one block before first todo", () => {
    const input = "## Title\n\nSome intro text\n\n- [x] first task";
    const merged = mergeConsecutiveFreeformLines(parseContent(input));
    expect(merged.length).toBe(2);
    expect(merged[0]).toEqual({
      isTodo: false,
      raw: "## Title\n\nSome intro text\n",
    });
    expect(merged[1].isTodo).toBe(true);
  });

  test("keeps separate free-form runs split by todos", () => {
    const merged = mergeConsecutiveFreeformLines(
      parseContent("Note A\n- [ ] t\nNote B"),
    );
    expect(merged.length).toBe(3);
    expect(merged[0]).toEqual({ isTodo: false, raw: "Note A" });
    expect(merged[1].isTodo).toBe(true);
    expect(merged[2]).toEqual({ isTodo: false, raw: "Note B" });
  });
});

describe("parseContent / serializeContent", () => {
  test("preserves - * + markers before checkboxes", () => {
    const input = "## x\n- [ ] a\n* [x] b\n+ [ ] c\n[ ] d";
    expect(serializeContent(parseContent(input))).toBe(`${input}\n`);
  });

  test("preserves numbered list markers like 1. 2. before checkboxes", () => {
    const input = "1. [ ] first\n2. [x] second\n10. [ ] tenth";
    expect(serializeContent(parseContent(input))).toBe(`${input}\n`);
  });

  test("bare checkbox lines unchanged", () => {
    const input = "[ ] one\n[x] two";
    expect(serializeContent(parseContent(input))).toBe(`${input}\n`);
  });
});

describe("toSlug", () => {
  test("lowercases and replaces spaces with hyphens", () => {
    expect(toSlug("My Shopping List")).toBe("my-shopping-list");
  });

  test("replaces underscores with hyphens", () => {
    expect(toSlug("work_tasks")).toBe("work-tasks");
  });

  test("collapses multiple spaces/hyphens", () => {
    expect(toSlug("hello   world")).toBe("hello-world");
    expect(toSlug("a--b")).toBe("a-b");
  });

  test("strips non-alphanumeric chars", () => {
    expect(toSlug("what's up?")).toBe("whats-up");
  });

  test("trims leading/trailing hyphens", () => {
    expect(toSlug(" -hello- ")).toBe("hello");
  });

  test("preserves dots", () => {
    expect(toSlug("v2.0")).toBe("v2.0");
  });

  test("simple name passes through", () => {
    expect(toSlug("shopping")).toBe("shopping");
  });
});

describe("validateCategoryName", () => {
  test("valid names", () => {
    expect(validateCategoryName("shopping")).toBeNull();
    expect(validateCategoryName("work-tasks")).toBeNull();
    expect(validateCategoryName("project.v2")).toBeNull();
    expect(validateCategoryName("sprint_3")).toBeNull();
    expect(validateCategoryName("A")).toBeNull();
    expect(validateCategoryName("My Shopping List")).toBeNull();
    expect(validateCategoryName("Sprint 3 Tasks")).toBeNull();
  });

  test("reserved names", () => {
    expect(validateCategoryName("t")).toContain("reserved");
    expect(validateCategoryName("w")).toContain("reserved");
    expect(validateCategoryName("T")).toContain("reserved");
    expect(validateCategoryName("W")).toContain("reserved");
  });

  test("empty name", () => {
    expect(validateCategoryName("")).toContain("required");
    expect(validateCategoryName("  ")).toContain("required");
  });

  test("name with only special chars", () => {
    expect(validateCategoryName("!!!")).toContain("at least one letter");
  });

  test("too long", () => {
    expect(validateCategoryName("a".repeat(101))).toContain("too long");
  });
});

describe("validateTodosText", () => {
  test("self-hosted skips validation", () => {
    const huge = "[ ] " + "x".repeat(20000);
    expect(validateTodosText(huge, true)).toBeNull();
  });

  test("valid document passes", () => {
    const text = `## Section
[ ] Todo 1
[x] Todo 2`;
    expect(validateTodosText(text, false)).toBeNull();
  });

  test("exceeds 10KB", () => {
    const text = "[ ] " + "x".repeat(10240);
    expect(validateTodosText(text, false)).toContain("10 KB");
  });

  test("exceeds 200 todos", () => {
    const lines = Array.from({ length: 201 }, (_, i) => `[ ] Todo ${i + 1}`);
    expect(validateTodosText(lines.join("\n"), false)).toContain("200");
  });

  test("200 todos is fine", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `[ ] Todo ${i + 1}`);
    expect(validateTodosText(lines.join("\n"), false)).toBeNull();
  });
});
