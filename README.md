# todos.in

**Minimal todos for humans and agents**

todos.in is a mobile-first PWA and CLI for managing todo lists. Users create named categories, each with a unique webhook URL, and manage todos via the web UI, the `todos` CLI, or a simple HTTP API. The canonical format is `todos.txt` — plain text, one todo per line, human-readable and agent-friendly. Login and billing are handled by Legendum.

Self-hostable: the same codebase runs at todos.in and locally via `bun run start`. Without `LEGENDUM_API_KEY`, it skips auth and billing entirely.

## Features

- **todos.txt format**: Plain text, one todo per line (`[ ]` / `[x]`). Free-form headings and notes are preserved verbatim.
- **Mobile-first PWA**: Portrait-optimized, thumb-friendly, installable to the home screen. Service worker via `workbox-build` with version-based cache invalidation.
- **Human and agent users**: Web UI for humans, webhook URLs for agents and scripts — no API keys required for webhooks.
- **`todos` CLI**: Syncs a local `todos.txt` with the server; position-based commands (`done`, `undo`, `del`, `first`, `last`); offline-capable.
- **Real-time updates**: SSE stream broadcasts changes so the web UI updates live as agents work.
- **Drag and drop**: Reorder categories and todos directly in the UI.
- **Legendum billing**: Micro-charges accumulated via Legendum tabs — 2 credits per category, 0.1 per webhook write.
- **Self-hostable**: MIT license. Single Bun binary + SQLite. No config file.

## Quick Start

### Install

```bash
git clone https://github.com/legendum/todos
cd todos
bun install
bun link
```

`bun link` makes the `todos` CLI available globally (via `bin` in `package.json` → `src/cli/main.ts`).

### Run the server

```bash
bun run start       # build web + run server
bun run dev         # build web + hot-reload server
```

Open http://localhost:3000.

### Use the CLI in a project

In any project directory:

```bash
todos               # first run prompts for TODOS_WEBHOOK, saves to .env
todos Buy milk      # add a todo
todos done 1        # mark todo 1 as done
todos               # list todos
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `todos` / `todos list` | List all todos, numbered from 1 |
| `todos <text>` | Add a new todo (any text not matching a command) |
| `todos done <n>...` | Mark todos at given positions as done |
| `todos undo <n>...` | Mark todos at given positions as not done |
| `todos del <n>` / `todos delete <n>` | Delete todo at position `n` |
| `todos first <n>...` | Move todos to the top (preserving order) |
| `todos last <n>...` | Move todos to the bottom |
| `todos open` | Open `todos.in/<category>` in the default browser |
| `todos skill` | Install the agent skill to `~/.claude/skills/todos/` and `~/.cursor/skills/todos/` |

Every command syncs `todos.txt` with the server first, applies the edit, then syncs again. Direct edits to `todos.txt` by hand are picked up on the next run.

## The `todos.txt` format

```
## Sprint 3
Context: shipping by Friday

[ ] Buy milk
[x] Fix bug #42
[ ] Deploy to prod

## Backlog
[ ] Refactor middleware
```

- Lines starting with `[ ] ` or `[x] ` are todo lines. Everything else is free-form text, preserved as-is.
- **Order = priority.** First todo line is most important.
- **Position** is counted among todo lines only (skipping free-form text).
- **Limits** (hosted mode): 10 KB per document, 200 todo lines per category.

## Project Structure

```
todos/
  src/
    api/              # HTTP server, route handlers, middleware
      server.ts
      handlers/
    web/              # React PWA frontend
      App.tsx
      components/
      entry.tsx
    cli/              # `todos` CLI
      main.ts
    lib/              # Shared utilities (db, legendum, mode)
  public/             # Static assets, logo, dist/
    todos.png
  config/
    schema.sql        # SQLite schema (users, categories)
    SKILL.md          # Agent skill (copied by `todos skill`)
    nginx.conf
  docs/
    CONCEPT.md
    SPEC.md           # Full product spec
    todos.yaml        # chats2me tool manifest
  data/
    todos.db          # SQLite database
  package.json        # bin: { "todos": "src/cli/main.ts" }
```

## API

All category routes support content negotiation: HTML (browsers), `text/plain` / `.txt` (todos.txt format), `application/json` / `.json`.

### Auth & Legendum

| Route | Description |
|-------|-------------|
| `GET /auth/login` | Login and link via Legendum |
| `GET /auth/callback` | Exchange code; set session cookie |
| `POST /auth/logout` | Unset session cookie |
| `/t/legendum/*` | Legendum middleware (link/unlink/billing widget) |

### Categories & todos (authenticated — cookie or `Authorization: Bearer <lak_...>`)

| Route | Description |
|-------|-------------|
| `GET /` | List all categories (sorted by position) |
| `POST /` | Create category (body: `name`) |
| `GET /:category` | Get todos (`todos.txt`) |
| `PUT /:category` | Replace all todos (body: full `todos.txt`) |
| `POST /:category` | Same as `PUT` |
| `DELETE /:category` | Delete category |

### Public webhook (no auth)

| Route | Description |
|-------|-------------|
| `GET /w/:ulid` | Get todos — **free** |
| `PUT /w/:ulid` | Replace all todos — **0.1 credits** |
| `POST /w/:ulid` | Same as `PUT` |
| `GET /w/:ulid/events` | SSE stream of updates |

Responses: `404` if not found, `402` if no Legendum account linked, `429` if charge fails.

## Data model

Two tables only:

- **users**: `id`, `email` (stable identity from Legendum), `legendum_token`, `created_at`.
- **categories**: `id`, `user_id`, `ulid` (webhook URL), `name`, `position`, `text` (raw `todos.txt`), `created_at`.

The server stores `todos.txt` verbatim in the `text` column — it doesn't parse items into rows.

Schema: [`config/schema.sql`](config/schema.sql).

## Billing

All billing goes through **Legendum tabs** — no local quota tracking.

| Action | Cost |
|--------|------|
| Category creation | 2 credits |
| Webhook write (`PUT`/`POST /w/:ulid`) | 0.1 credits |
| Reads (any `GET`) | Free |
| Authenticated writes (`PUT`/`POST /:category`) | Free |

Micro-charges accumulate to a **2-credit tab threshold** before settling as a single Legendum charge.

## Configuration

No config file required. All configuration via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server listen port |
| `HOST` | `0.0.0.0` | Server bind host |
| `TODOS_DOMAIN` | `http://localhost:$PORT` (dev) / `https://todos.in` (prod) | Public domain |
| `TODOS_DB_PATH` | `data/todos.db` | SQLite path |
| `TODOS_COOKIE_SECRET` | — | Required in hosted mode |
| `LEGENDUM_API_KEY` | — | If set, enables hosted mode (auth + billing). If unset, self-hosted mode. |
| `LEGENDUM_SECRET` | — | Required when `LEGENDUM_API_KEY` is set |
| `LEGENDUM_BASE_URL` | `https://legendum.co.uk` | Legendum server |

### Per-project (for the CLI)

| Variable | Description |
|----------|-------------|
| `TODOS_WEBHOOK` | Webhook URL used by the `todos` CLI (stored in project `.env`) |

## Self-Hosting

Run locally with no auth or billing:

```bash
git clone https://github.com/legendum/todos
cd todos
bun install
bun run start
```

Without `LEGENDUM_API_KEY`, the server runs in **self-hosted mode**: no login, no billing, no document-size or todo-count limits. Everything is free and unlimited.

## Development

### Prerequisites

- [Bun](https://bun.sh/) runtime (handles runtime, backend, frontend bundling, scripts, and CLI — no Node, npm, or Vite)
- SQLite (via `bun:sqlite`, bundled with Bun)

### Setup

```bash
git clone https://github.com/legendum/todos
cd todos
bun install
```

### Run in Development

```bash
bun run dev    # hot-reload server + web build
bun test       # run tests
bun run lint   # biome check
```

### Build

```bash
bun run build  # clean public/dist/ and rebuild web + service worker
```

Service worker is generated by `workbox-build` (`generateSW()`) with `cacheId` tied to `package.json` version — bumping the version invalidates all client caches on deploy.

## Agent skill

```bash
todos skill
```

Copies [`config/SKILL.md`](config/SKILL.md) to `~/.claude/skills/todos/SKILL.md` and `~/.cursor/skills/todos/SKILL.md`, teaching Claude Code and Cursor to:

- Check `todos` at the start of a session
- Mark todos done as they're completed
- Add new todos when discovering work to do

## Tech stack

- **Runtime**: Bun (everything — server, bundler, scripts, CLI)
- **Backend**: TypeScript + `Bun.serve` + `bun:sqlite`
- **Frontend**: React 18 + TypeScript, bundled by Bun, custom CSS (no Tailwind)
- **PWA**: `workbox-build` generateSW, version-based cache invalidation
- **Drag & drop**: `@dnd-kit/core` + `@dnd-kit/sortable`
- **DB**: SQLite at `data/todos.db`
- **Auth**: Legendum OAuth (login + link in one flow)
- **Billing**: Legendum tabs
- **Linter**: Biome

## Contributing

See [docs/SPEC.md](docs/SPEC.md) for the full product spec and [docs/CONCEPT.md](docs/CONCEPT.md) for the original concept.

## License

MIT — see [LICENSE](LICENSE).
