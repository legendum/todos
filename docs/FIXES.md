# Todos — Pending Fixes

Three small fixes. Each section is self-contained: what, why, where, and the acceptance bar.

---

## 1. Scroll to bottom when opening a todo list

**What**: When the user opens a category (from the home list, deep link, or browser back/forward), the todo list should be scrolled to the bottom on first paint.

**Why**: The newest todos are at the bottom. Today the list opens at the top, so the user has to scroll down to see what was most recently added — especially jarring after using the CLI, where freshly-added items land at the end.

**Where**:
- `src/web/components/TodoList.tsx` — owns the scroll container (`listScrollRef`). The existing "add row" handler already does `el.scrollTop = el.scrollHeight` inside `requestAnimationFrame` (around line 368); reuse the same idiom.
- Trigger point: the effect that sets initial `lines` from the memory cache / IndexedDB / network. Scroll once the first non-empty `lines` render has painted.

**Details**:
- Scroll should be instant (not smooth) — this is an initial-position concern, not a navigation animation.
- Must fire after lines are rendered, not before (hence `requestAnimationFrame`, or a layout effect keyed on `lines.length` with a "has-scrolled-once" guard per `category.slug`).
- Keyed on `category.slug`: re-opening a different category re-runs the initial scroll; re-renders within the same category must not re-snap to the bottom (otherwise the user loses their scroll position while editing).
- If the list is shorter than the viewport, the scroll is a no-op — fine.

**Acceptance**:
- Open a category with > 1 screen of todos → list is scrolled to the bottom.
- Scroll up, tap/edit an existing todo → list stays where the user left it (no re-snap).
- Back out, open a different category → that new category opens scrolled to the bottom.

---

## 2. `todos purge` — remove all done items

**What**: Add a new CLI subcommand: `todos purge`. Removes every `[x]` line from `todos.md`, then syncs.

**Why**: After a burst of work, `todos.md` fills up with completed items. Today the only way to clear them is `todos del <n>` one at a time (or manual editing). A single-word command is the natural fit.

**Where**:
- `src/cli/main.ts` — add a new branch in the command dispatcher (around lines 220–292, alongside `done`, `undo`, `del`, `first`, `last`).
- `printHelp()` (around line 130) — add the new line.
- `docs/SPEC.md` §2.6 ("CLI: `todos` command") — add `todos purge` to the usage list and note the single-word rule.

**Command parsing — critical**:
- `purge` matches **only** when it is the sole argument (`args.length === 1`). This mirrors how `open` and `skill` are gated today.
- Anything else — `todos purge the database`, `todos purge old notes` — falls through to the "new todo" branch and is added as literal text. This is the same fall-through pattern that protects `open a restaurant` and `delete the evidence` (see SPEC §2.6).

**Behaviour**:
- Drop every `ParsedLine` where `isTodo && todo.done`. Leave free-form text (headings, notes, blank lines) alone.
- If nothing was done, the command is a no-op that still triggers the normal sync round-trip.
- Prints the resulting list (same output as plain `todos`) so the user sees what remains.
- Works offline the same way as other edits: writes `todos.md` locally, skips the push, prints the existing "(offline — changes saved locally only)" notice.

**Acceptance**:
- `todos purge` with a mix of `[ ]` and `[x]` items → only `[ ]` items remain, locally and on the server.
- `todos purge the database` → a new todo `"purge the database"` is added; no items are deleted.
- `todos purge` on a list with zero done items → no-op, still prints the list.
- Free-form text between todos is preserved byte-for-byte.

---

## 3. Filter bar should filter todos when viewing a list

**What**: When a category is open, typing in the top filter input filters the visible todo items within that list. When on the home screen, it filters categories (unchanged from today).

**Why**: The filter is already pinned to the top of the viewport, and users reach for it instinctively inside a list. Today, typing there yanks them back to the home screen (see `App.tsx` line 138–142: `if (next.length > 0 && selectedCategory) goBack();`) — a surprising redirect that this fix removes.

**Where**:
- `src/web/App.tsx` — remove the `goBack()` side-effect in `handleSetFilterQuery`. The query should simply flow through to whichever view is mounted.
- `src/web/components/TodoList.tsx` — accept `filterQuery` as a prop and apply it to the rendered rows.
- `src/web/components/CategoriesList.tsx` — no change; it already consumes `filterQuery`.

**Filtering rules inside a list**:
- Case-insensitive substring match against the todo's `text`.
- Only **todo rows** are filtered. Free-form text rows (headings, notes, blank lines from `MarkdownBlock`) are hidden while a non-empty filter is active — they're context for unfiltered reading, not search results.
- Filtering is **display-only**: the underlying `lines` array is untouched, so serialize/save/sync still round-trip the full document. No todo is deleted, moved, or renumbered by filtering.
- Drag-and-drop and the "add todo" input should be disabled (or at least visually de-emphasised) while a filter is active — reordering a filtered subset would rearrange unseen neighbours in confusing ways. Simplest: hide the drag handles and the add-row input when `filterQuery` is non-empty.
- Done/undo/delete/edit on a visible filtered row must still work and target the correct underlying index.
- Clearing the filter (× button, or empty input) restores the full list with the user's scroll roughly where it was — don't snap back to top or bottom.

**What stays the same**:
- Home screen behaviour: filter matches against category name **and** slug, exactly as today.
- The filter input itself, its placeholder (`"Filter..."`), keyboard behaviour, and pinned-to-visual-viewport logic in `TopBar.tsx`.

**Acceptance**:
- On home, typing `gro` narrows the category list (unchanged).
- Open a category, type `milk` → only todo rows containing "milk" (case-insensitive) remain visible; free-form lines are hidden; the user stays in the list (no redirect home).
- Clear the filter → full list returns, scroll position preserved.
- Check a filtered item as done → it updates the correct row; on clearing the filter the change is in the right place in the full list.
- Hit back → returns to home with the filter value preserved (or cleared — pick one and note it; recommendation: **preserve** so the user can keep scanning across categories).
