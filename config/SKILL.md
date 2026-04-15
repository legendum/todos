---
name: todos
description: >-
  Sync todos with todos.in via TODOS_WEBHOOK in .env: run `todos`, edit
  todos.md (freeform Markdown + task lists), run `todos` again after changes.
  Read the whole file for planning context, not only checkboxes.
---

# Todos — Agent Skill

## Sync workflow

1. Ensure `.env` has `TODOS_WEBHOOK`, or prompt the user to add it (from the category on [todos.in](https://todos.in)).
2. To sync and list todos, run `todos` — this updates `todos.md` from the server.
3. Edit `todos.md` using standard Markdown task lists: `- [ ] undone task` or `- [x] completed task`. **Freeform Markdown outside task lists is supported** (planning prose, links, headings).
4. Run `todos` again to push local changes to the server (if any).

## Planning document (not only a checklist)

Use `todos.md` as a **lightweight plan**: narrative and constraints up top, **actionable checkboxes** for work that should sync with todos.in.

**Suggested structure (top → bottom):**

1. **Title + one-line intent** — what “done” means.
2. **Context** — why this exists; links, branch, tickets, prior decisions.
3. **Constraints** — what to avoid while executing.
4. **Non-goals** — explicitly out of scope.
5. **Plan / phases** — Markdown sections (`### Phase 1`, etc.); place **`- [ ]` / `- [x]` tasks under the phase** they belong to (or use one separate checklist section if you prefer).
6. **Open questions** — unresolved decisions or dependencies so the next session does not re-litigate. Use prose, bullets, or short lines as needed.

Put prose first so the file reads as a **plan**; use checkboxes for the **executable slice** that syncs with todos.in (wherever they appear in the file).

## For agents

- **Read the entire `todos.md`** for goals and constraints, not only unchecked items.
- After completing work that satisfies a checkbox, **mark it `[x]`** and run `todos` again if `todos.md` changed.
- Do not strip or ignore freeform sections when editing; preserve planning text unless the user asks to trim it.
- When editing phases, **keep `- [ ]` / `- [x]` syntax** on task lines so sync and renderers still recognize them.

## Minimal `todos.md` template

Copy into a repo when introducing todos. Adjust headings to taste.

```markdown
# <short project or effort name>

**Intent:** <one sentence: what “done” looks like>

## Context

<why this exists, links, branch, tickets>

## Constraints

<what to avoid>

## Non-goals

<explicitly out of scope>

## Plan

### Phase 1

<prose or bullets>

- [ ] <first concrete task>
- [ ] <second concrete task>

### Phase 2

<prose or bullets>

- [ ] <first task in phase 2>
- [ ] <second task in phase 2>

## Open questions

<still unclear — e.g. API choice, owner, deadline>
<another open point if needed>
```
