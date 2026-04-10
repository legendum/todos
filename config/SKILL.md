---
name: todos
description: >-
  Sync todos with todos.in via TODOS_WEBHOOK in .env: run `todos`, edit
  todos.txt, run `todos` again if you changed anything.
---

# Todos — Agent Skill

1. Ensure `.env` has `TODOS_WEBHOOK`, or prompt the user to add it (from the category on [todos.in](https://todos.in)).
2. To sync and list todos, run `todos` — this updates `todos.txt` from the server.
3. Edit `todos.txt`. Each todo line should start with either `[ ] some undone task` or `[x] some completed task`.
4. Run `todos` again to push local changes to the server (if any).

That's it.
