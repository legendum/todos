import { describe, expect, test } from "bun:test";
import { parseLines, serializeLines } from "../src/web/components/lines";

describe("parseLines / serializeLines", () => {
  test("empty input returns empty array", () => {
    expect(parseLines("")).toEqual([]);
  });

  test("assigns sequential line-N ids", () => {
    const lines = parseLines("[ ] one\n[x] two\nfree text\n");
    expect(lines.map((l) => l.id)).toEqual(["line-0", "line-1", "line-2"]);
  });

  test("preserves done flag, indent, and list marker", () => {
    const lines = parseLines("- [ ] alpha\n  [x] beta\n");
    expect(lines).toEqual([
      {
        id: "line-0",
        isTodo: true,
        done: false,
        text: "alpha",
        indent: "",
        listMarker: "-",
      },
      {
        id: "line-1",
        isTodo: true,
        done: true,
        text: "beta",
        indent: "  ",
        listMarker: undefined,
      },
    ]);
  });

  test("merges consecutive free-form lines into a single block", () => {
    const lines = parseLines("intro\nmore intro\n[ ] a todo\nfooter\n");
    const freeform = lines.filter((l) => !l.isTodo);
    expect(freeform).toHaveLength(2);
    expect(freeform[0].text).toBe("intro\nmore intro");
    expect(freeform[1].text).toBe("footer");
  });

  test("round-trip preserves todos.md content verbatim", () => {
    const md =
      "## Sprint 3\nContext: ship by Friday\n\n[ ] Buy milk\n[x] Fix bug\n- [ ] Deploy\n";
    expect(serializeLines(parseLines(md))).toBe(md);
  });

  test("round-trip preserves indented and marked todos", () => {
    const md = "[ ] top\n  - [x] nested\n";
    expect(serializeLines(parseLines(md))).toBe(md);
  });
});
