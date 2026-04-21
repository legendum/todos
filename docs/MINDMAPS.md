# Mindmaps — Brainstorm

A minimal PWA for **mindmaps as outlines**, modelled on `todos`. Hosted at **mindmaps.page**. One Markdown file per mindmap, human-readable and agent-friendly, edited through an interactive outliner with collapse/expand.

This doc is an exploration, not a final spec. The goal is to transplant what worked for `todos` and flag what differs because the data is a tree instead of a flat list.

---

## 1. Intent

- **User signs up** via Login with Legendum (same flow as todos).
- **User creates mindmaps** — each is a named map with a unique webhook URL. Each mindmap has **exactly one root**; the mindmap's name *is* the root's label. Renaming the mindmap renames the root. Mindmaps are the equivalent of categories in todos.
- **User edits via an outliner** — Tab/Shift-Tab to indent, Enter for a sibling, click the chevron to collapse/expand, drag a node to reparent.
- **The canonical format is a nested Markdown bullet list inside a `.md` file** — plain text, renders natively in any Markdown viewer, agent-editable.
- **Agents** (Claude Code, Cursor, scripts) manage mindmaps through the CLI or webhook, identical to `todos`.

"Done" = a user can create a mindmap at `mindmaps.page/<name>`, type their way to a 30-node outline, collapse branches they don't care about right now, and an agent can read/write the same map via a webhook by sending a nested bullet list.

---

## 2. Why an outliner (and not Mermaid)

Earlier brainstorming considered Mermaid `mindmap` as the canonical format. We rejected that for the MVP:

- **Mermaid is view-only by design.** Interactive editing lives above the SVG or replaces it — either way, we own the layout and the gestures.
- **Trees don't need a graph engine.** A radial render is a nice visual but a bad editor; an outliner is a good editor and renders nicely in every Markdown viewer for free.
- **Indentation *is* the data.** Nested `- item` lines are the simplest possible canonical form, matching todos' "one line per item" philosophy.
- **Mobile UX is solved.** A vertical list beats pan-zoom-drag on a touch surface.
- **Pattern is well-understood.** Workflowy, Dynalist, Logseq, Roam's outliner mode, Apple Notes checklists — users know how to drive it without onboarding.

Mermaid comes back as an **optional read-only render** — see §11.

---

## 3. The document format

A mindmap document is a Markdown file representing a **single-rooted tree**. The root is the mindmap itself — its label is the mindmap's name, held in server metadata, not repeated in the file. The file contains the **root's children and their descendants** as a nested bullet list. Everything else is **free-form text** (notes, context, links) preserved byte-for-byte, same rule as `todos.md`.

Example `mindmap.md` (for a mindmap named "Product launch"):

```markdown
Context: shipping Q3, cross-functional.
Stakeholders: eng, marketing, ops.

- Engineering
  - API freeze
  - Perf budget
- Marketing
  - Landing page
  - Press list
- Ops
  - SLA review
```

Rules:
- Each `- ` (or `* ` / `+ `) line is a **node**. Indentation defines parent/child — 2 spaces per level.
- **Top-level bullets are the root's direct children.** The root itself is implicit — it's the mindmap. Same shape as todos: `todos.md` doesn't repeat the category name either.
- Non-bullet lines outside the list are **free-form text**, preserved unchanged across edits.
- Node identity = full text + position among siblings. No IDs in the external API — same philosophy as todos.
- Optional per-node state (`[ ]` / `[x]`) is allowed; rendered as a checkbox. Lets a mindmap double as a checklist for a branch.

Limits (match todos' shape):
- **Max doc size**: 20 KB.
- **Max nodes**: 500 per mindmap.

---

## 4. User flows

### 4.1 Auth
Identical to todos — Login with Legendum, email as stable identity, encrypted session cookie, auto-logout on unlink.

### 4.2 Home: list of mindmaps
- `mindmaps.page/` shows the user's mindmaps.
- Each row: name, **`done/total` count of checkbox nodes** (same roll-up as a todos category; nodes without a `[ ]`/`[x]` marker aren't counted), and last-updated.
- Drag to reorder (same DnD as todos categories).
- Filter bar at the top (same pattern as todos: matches name and slug).
- Empty state: "No mindmaps yet. Tap + to create one."

### 4.3 Single mindmap view
- `mindmaps.page/<name>` — authenticated.
- **Header** shows the mindmap name — this is the root of the tree. Click to rename (same pattern as a todos category title, which renames the slug + updates on the home row).
- Two modes, one-tap switch in the header:
  1. **Outline** — the interactive editor (default). Renders the root's children as the top level; the root itself is the page title, not a bullet.
  2. **Source** — raw Markdown, editable as text. Saving round-trips.
- Webhook URL shown below the title, one-tap copy (same component as todos).
- Share icon exports the `.md` file. Exported file optionally includes a leading `# <mindmap name>` heading so the export reads as a self-contained doc.

### 4.4 Webhook (agents)
- `mindmaps.page/w/<ulid>` — public, no auth.
- `GET` returns the full Markdown.
- `PUT` replaces the document.
- Returns `X-Updated-At` for sync, same as todos.
- No `PATCH` ops for MVP — agents just PUT the full doc. Re-serialise from an in-memory tree if they want surgical edits.

---

## 5. The outliner — interactions

Keyboard (desktop):
- **Enter** — new sibling below the current node.
- **Tab** — indent (become a child of the previous sibling).
- **Shift-Tab** — outdent (become a sibling of current parent).
- **Backspace at start of text** — outdent, then if already at root, merge with previous sibling.
- **Cmd/Ctrl-Enter** — toggle collapse on current node.
- **Cmd/Ctrl-↑ / ↓** — move node up/down among siblings.
- **Cmd/Ctrl-Delete** — delete node; children are promoted to its parent (safer default than cascade). Hold Shift to cascade-delete.
- **Esc** — blur the editor.
- **↑ / ↓** — move caret to previous/next visible node.

Mouse / touch:
- **Click chevron** — collapse/expand a branch.
- **Click row** — focus into edit mode.
- **Drag handle** — reparent (drop onto a node = become its child; drop between rows = become a sibling). Reuse todos' `@dnd-kit` setup.
- **Swipe left** on mobile — reveal Edit/Delete buttons, identical to todos rows.
- **Long-press** — multi-select mode (non-MVP).

Empty state in an open mindmap: "Type to add a node. Tab to indent, Enter for a sibling."

Visual niceties (cheap, high-impact):
- Connecting guide lines down the left margin between a parent and its children.
- Collapsed nodes show a subtle `(N)` count of hidden descendants.
- Smooth height animation on expand/collapse.

---

## 6. CLI: `mindmaps` command

Direct clone of `todos` — sync first, edit, sync again. Nodes addressed by **path** from the root (root-implicit; `>` separates levels). A path starting without a `>` is a direct child of the root.

```
mindmaps                                  show the outline (indented under the mindmap name)
mindmaps add "Engineering" "QA"           add child "QA" under "Engineering"
mindmaps add "QA"                         add "QA" as a direct child of the root
mindmaps rename "QA" "Quality"            rename a node
mindmaps del "Engineering > QA"           delete a node; children promoted
mindmaps move "QA" under "Ops"            reparent
mindmaps open                             open mindmaps.page/<name>
mindmaps skill                            install agent skill
```

Single-word subcommands (`open`, `skill`) only match with no other args; anything ambiguous falls through to "add a top-level node" — same parsing discipline as todos.

Path ambiguity: duplicate sibling names (two "QA" nodes under the same parent) can't be addressed by path alone. CLI errors with "ambiguous path, 2 matches" and lists them with line numbers. Rare in practice; the escape hatch is `mindmaps <line-number> ...`.

First run prompts for webhook URL, writes to `.env` as `MINDMAPS_WEBHOOK`. Local file: `mindmap.md` in the repo root, synced both ways. Same pattern as todos.

---

## 7. Sync and storage

Reuse the todos architecture verbatim:
- SQLite on the server; `users`, `mindmaps`, optional `mindmap_versions`.
- IndexedDB on the client for offline reads and queued writes.
- SSE stream per mindmap for live updates (`/w/<ulid>/events`).
- Debounced PUT on edit (300ms, same as todos).
- `X-Updated-At` + pending flag for conflict resolution.

**Collapsed state**: user-specific, per-browser preference — does **not** belong in the canonical `.md` file (sharing it would force collapsed state on everyone). Store in IndexedDB, keyed by mindmap slug + node path. If we need cross-device sync of collapsed state, add a user-scoped sidecar doc; out of scope for MVP.

**Version history**: worth designing the schema for from day one. A mindmap edit ("I just reparented a big branch") is more undo-worthy than a todo toggle. MVP: keep last 20 server-side versions, expose `GET /w/<ulid>/versions` and a simple undo UI later.

---

## 8. Agent skill

A `SKILL.md` shipped in `config/`, installable via `mindmaps skill` to Claude Code / Cursor skill dirs. Teaches:
- How to read `mindmap.md`.
- The nested-bullet subset to write (2-space indent, `- ` markers).
- That free-form text outside the list is planning prose — preserve it.
- How to run `mindmaps` to sync.

---

## 9. Risk ranking (what could kill the MVP)

1. **Outliner keyboard/IME edge cases**. Tab-to-indent, caret-movement, multi-line paste, RTL text, mobile virtual keyboards — these eat weeks in every outliner project. Budget for it. Consider leaning on an existing React outliner component before rolling one.
2. **Drag-to-reparent gesture disambiguation**. Dragging a leaf onto its own ancestor must be prevented or handled cleanly. `@dnd-kit` gets us most of the way; the validation logic is ours.
3. **Round-tripping free-form text** around and between the bullet list without mangling it. Todos already solved this shape of problem; same test discipline applies.

Everything else (auth, sync, CLI, storage, agents, DnD reorder) transplants from todos.

---

## 10. Non-goals

- Real-time collaborative editing (CRDT/OT). Single-writer model with SSE broadcasts is plenty for MVP.
- Styling (colours, fonts, icons on nodes). Content first.
- Arbitrary cross-edges (graph). See §11.
- Import from FreeMind / XMind / OPML. Nice, not MVP. (OPML is close — indented tree with a different syntax; a one-file importer is cheap if asked.)
- Multi-user sharing with per-user permissions. Webhook URL = public read/write, same tradeoff as todos.
- Export to PDF / PNG. Browser print + `.md` + SVG (from §11) cover 95%.

---

## 11. Future enhancements

### 11.1 Mermaid render mode

Once the outliner feels solid, add a **read-only "View as mindmap" button** that renders the current tree through Mermaid's `mindmap` diagram. Reasons to want it:
- The classic radial look triggers different thinking than a vertical outline for some users.
- Shareable screenshot / embed in docs, GitHub issues, Notion pages.
- Presentation mode for meetings.

Implementation: serialise the in-memory tree to Mermaid `mindmap` syntax on demand, hand it to the `mermaid` library, render to SVG. No editing, no round-trip concerns — the outliner is still the source of truth. Add a "Copy as Mermaid" button so users can paste into any Mermaid-aware tool.

### 11.2 Cross-references ("see also")

Tree-only is the right call for the MVP (see earlier discussion), but users will eventually want a node to reference another without reparenting. Proposed: a `@path.to.node` syntax inside node text renders as a click-to-jump link and, in the Mermaid render, as a dashed edge. Keeps the canonical file a tree; adds a second visual pass for the extras.

### 11.3 Server-side version history UI
Schema is ready from day one (§7); build the drawer with a list of versions, preview on hover, restore on click.

### 11.4 Node state beyond checkboxes
Priorities, tags, due dates. Each adds a column to the outliner and a syntax to the canonical file. Only add one after users ask twice.

### 11.5 OPML import / export
Opens the door to migrating from other outliners / mindmap tools.

### 11.6 Collaborative editing
CRDT (Yjs) over the SSE channel. Big lift, worth it only once multi-writer is an actual pain.

---

## 12. Decisions

- **Name**: **Mindmaps** (plural — matches todos and reads naturally, regardless of the singular domain).
- **Checkbox rollups**: the home-row `done/total` count includes every node with a `[ ]` or `[x]` marker, ignoring unmarked nodes. Same `countTodos`-shaped helper as todos, recursed across the tree.
- **Bullet parser**: roll our own (~100 lines, strict 2-space indent, `-` / `*` / `+` markers, preserves free-form text lines). Lives in `src/lib/mindmaps.ts` alongside a `serializeTree` counterpart, mirroring `src/lib/todos.ts`. No `remark` dependency.
