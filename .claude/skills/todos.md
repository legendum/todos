# Todos — Agent Skill

This project uses the `todos` CLI to track work via [todos.in](https://todos.in). The webhook URL is stored in `.env` as `TODOS_WEBHOOK`.

## When to use

- **Start of session**: Run `todos` to see outstanding work.
- **Completing work**: Run `todos done <n>` to mark finished items.
- **Discovering work**: Run `todos <description>` to add new items.

## Commands

```
todos                  # list all todos (numbered)
todos list             # same as above
todos done 1 3 5       # mark todos 1, 3, 5 as done
todos undo 2           # mark todo 2 as not done
todos del 3            # delete todo 3
todos first 4 6        # move todos 4, 6 to the top
todos last 2           # move todo 2 to the bottom
todos open             # open the category in the browser
todos Buy milk         # add "Buy milk" as a new todo
```

## How it works

- Todos are numbered by position (1 = first).
- The CLI syncs a local `todos.txt` with the server on every run.
- The format is plain text: `[ ] not done` and `[x] done`.
- Free-form text lines (headings, notes) are preserved as-is.
- You can also edit `todos.txt` directly — changes sync on the next CLI run.

## First run

If `TODOS_WEBHOOK` is not set in `.env`, the CLI will prompt for the webhook URL. You can find it in the category header on todos.in.
