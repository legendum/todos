# Todos — Product Spec

A minimal PWA: **create categories → manage todo lists via web UI, CLI, or webhook**. Hosted at **todos.in**. Designed for both human and agent users.

---

## 1. What it does

- **User signs up** via Login with Legendum (email-only OAuth).
- **User creates categories** — each category is a named todo list with a unique webhook URL.
- **User manages todos** — via the web UI, the `todos` CLI, or the webhook API.
- **The canonical format is `todos.txt`** — a plain text file, one todo per line, human-readable and agent-friendly.

```
[ ] Buy milk
[x] Fix bug #42
[ ] Deploy to prod
```

The server stores todos in SQLite but every API surface speaks this format. The CLI syncs a local `todos.txt` in the project repo.

---

## 2. User flows

### 2.1 Auth (Login with Legendum)

1. **Login**: User clicks "Login with Legendum" → redirect to Legendum OAuth authorization URL with CSRF state token.
2. **Callback**: Legendum returns to `/t/auth/callback` with code + state → backend exchanges code for `{ email, linked, legendum_token }`.
3. **Session**: Backend creates/updates user in `users` table, sets encrypted session cookie (HMAC-SHA256, 30-day expiry).
4. **Logout**: `POST /t/auth/logout` → unset cookie.
5. **Legendum middleware**: All Legendum integration (login, linking, billing) uses the Legendum SDK (`src/lib/legendum.js`) and Legendum middleware for `/t/legendum/*` routes.

No passwords, no extra profile fields. Email = identity.

### 2.2 Categories

1. **Dashboard** (after login): List of categories. "Create category" → user enters a name → we generate a unique ULID for the webhook URL.
2. **Web URL**: `todos.in/<name>` — authenticated, session-based. The category name is the route, scoped to the logged-in user. Names must be unique per user. Reserved names: `t`, `w` (rejected on category create).
3. **Webhook URL**: `todos.in/w/<ulid>` — public, no auth. For agents and scripts.
4. **Each category** contains an ordered list of todo items.

### 2.3 Todos

A todo is a line of text with a done state. That's it.

- **Format**: `[ ] Buy milk` (not done) or `[x] Buy milk` (done).
- **Position** = line number. Line 1 is position 1.
- **No slugs, no IDs** in the external API. Todos are addressed by position or by their full text content.

### 2.4 The `todos.txt` format

The canonical format for reading and writing todos. Used by the CLI, the webhook API, and content-negotiated responses.

```
[ ] Buy milk
[x] Fix bug #42
[ ] Deploy to prod
```

Rules:
- One todo per line.
- Lines starting with `[x] ` are done; lines starting with `[ ] ` are not done.
- Order = priority. First line is most important.
- Empty lines and lines not matching the pattern are ignored.

### 2.5 Drag and drop

- **Todos** can be dragged up/down within a category to reorder. Updates position on drop.
- **Categories** can be dragged up/down on the main screen to reorder. Updates position on drop.
- Same drag-and-drop pattern as chats in ../chats2me.

### 2.6 CLI: `todos` command

A lightweight CLI that does two things: (1) syncs `todos.txt` with the server, and (2) provides easy commands to edit it. Every command syncs first, then edits, then syncs again. All commands reference todos by **line number** (numbered from 1).

**Command parsing**: Commands like `done`, `del`, `first`, `last` only match when followed by numeric positions. `open` only matches with no arguments. Anything else is treated as a new todo. Examples: `todos open a restaurant` adds "open a restaurant"; `todos delete the evidence` adds "delete the evidence"; `todos del 4` deletes todo at position 4.

1. **First run**: Prompts for webhook URL → saves it to `.env` as `TODOS_WEBHOOK`.
2. **Subsequent runs**: Reads `TODOS_WEBHOOK` from `.env`.
3. **Usage**:
   - `todos` or `todos list` — list all todos, numbered from 1
   - `todos done 1 3 5` — mark todos at lines 1, 3, 5 as done
   - `todos undo 1 3 5` — mark todos at lines 1, 3, 5 as not done
   - `todos del 2` / `todos delete 2` — delete todo at line 2
   - `todos first 4 6` — move todos at lines 4 and 6 to the top (lines 1 and 2, preserving order)
   - `todos last 2 5` — move todos at lines 2 and 5 to the bottom (2 before 5)
   - `todos open` — open `todos.in/<category>` in the default browser
   - `todos Buy milk` — any text that doesn't match a command is added as a new todo at the end
4. **Output** is the `todos.txt` format, numbered:
   ```
   1. [ ] Buy milk
   2. [x] Fix bug #42
   3. [ ] Deploy to prod
   ```
5. **Install**: `bun link` in the repo makes `todos` available globally (via `bin` in package.json → `src/cli/main.ts`).

### 2.7 Local `todos.txt` sync

The CLI maintains a local `todos.txt` file in the project directory. This file is the local source of truth — agents and humans can edit it directly without using the CLI.

- **Every command** starts by reading the current `todos.txt` from disk (respecting any manual edits), then:
  - **Online**: Fetch the server's version (`GET /w/:ulid`), merge with local, apply the command, push back (`PUT /w/:ulid`), and write the result to `todos.txt`.
  - **Offline**: Apply the command to local `todos.txt` only. Next time the CLI can reach the server, it merges and syncs.
- **Direct edits**: If an agent or user edits `todos.txt` by hand (adding lines, checking items off, reordering), the CLI picks up those changes on the next run and syncs them to the server.
- **Merge strategy**:
  1. **Union**: combine server and local todos, de-dup by exact text match.
  2. **Done wins**: if either side marked a todo done, it stays done.
  3. **Order**: server's order as base, locally-added todos appended at the bottom.
  4. **Push** the merged result back via `PUT`.

### 2.8 Agent skill (Claude Code / Cursor)

A skill file (e.g. `.claude/skills/todos.md` or `.cursorrules`) that teaches agents about the `todos` CLI and encourages them to use it while working on a project:

- Check `todos` at the start of a session to see outstanding work
- Mark todos done as they're completed
- Add new todos when discovering work that needs doing
- The skill should explain the CLI commands and that `TODOS_WEBHOOK` in `.env` connects to the project's todo list

### 2.9 Tool integration (chats2me)

External tools like chats2me access the authenticated API using a Legendum account key (`lak_...`) as a bearer token. The API uses clean category-name routes matching the `todos.in/<name>` pattern:

- `GET /` — list all categories
- `GET /:category` — get todos (returns `todos.txt` format, or JSON/YAML/Markdown via content negotiation)
- `POST /:category` — append todos (body is `todos.txt` format lines to add)
- `PUT /:category` — replace all todos (body is full `todos.txt` content)
- `DELETE /:category` — delete the category

Responses support `.md`, `.json`, `.yaml`, `.txt` extensions for format selection. See `docs/todos.yaml` for the chats2me tool manifest.

---

## 3. Data we store (minimal)

**Hierarchy:** A user has categories; a category has todos.

- **users**: `id` (PK), `email` (UNIQUE), `quota_basic` (default 100; reset every 7 days), `quota_extra` (default 0; for generous friends), `quota_reset` (Unix epoch of last reset), `legendum_token` (for Pay with Legendum), `created_at`.
- **categories**: `id` (PK, INTEGER auto-increment), `user_id` (FK), `ulid` (UNIQUE, for webhook URL `/w/:ulid`), `name`, `position` (INTEGER, for user-defined ordering), `text` (TEXT, the raw `todos.txt` content), `created_at`.

That's it. Two tables. The `text` column stores the canonical `todos.txt` content — the server doesn't parse it into rows.

Schema: see `schema.sql`.

---

## 4. Tech stack

- **Bun for everything**: runtime, backend, frontend tooling, scripts, and CLI. No Node, npm, pnpm, or Vite.
- **Backend**: **Bun** + **TypeScript**. HTTP server (Bun.serve), SQLite via `bun:sqlite`.
- **Frontend**: Bundled by **Bun**; **React** + **TypeScript**; PWA with service worker; **mobile-first**, portrait viewport as primary.
- **PWA / Service Worker**: Generated by **workbox-build** (`generateSW()`). Cache ID tied to `package.json` version for automatic cache invalidation on deploy. Build cleans `/public/dist/` before each run. SW registered with `updateViaCache: "none"` and page reloads on `controllerchange`.
- **UI**: Custom CSS; mobile-first, no Tailwind/shadcn.
- **DB**: **SQLite** at `data/todos.db`.
- **Domain**: **todos.in**.
- **CORS**: Open to `*` for API and webhook endpoints.
- **No push notifications**: Todos does not implement FCM or push. If needed later, integrate with the Alert service.
- **Self-hostable**: MIT license. Single binary (Bun), SQLite database. No config file required — just `bun run src/api/server.ts` with sensible defaults. If `LEGENDUM_API_KEY` is not set, assume self-hosted mode: skip Legendum auth/billing, disable quota enforcement, and serve todos without login. Install globally via `bun link`.

### Project structure

```
src/
  api/              # HTTP server, route handlers, middleware
    server.ts
    handlers/
  web/              # React frontend
    App.tsx
    components/
    entry.tsx
  cli/              # CLI command parser
    main.ts
  lib/              # Shared utilities
    db.ts
    legendum.js
public/             # Static assets (logo, manifest, dist/)
  todos.png
scripts/
  reset-quota-weekly.ts
docs/
  CONCEPT.md
  SPEC.md
  todos.yaml        # chats2me tool manifest
schema.sql
package.json        # bin: { "todos": "src/cli/main.ts" }
biome.json
tsconfig.json
```

### Backend responsibilities

- Legendum OAuth login flow via Legendum SDK and middleware.
- Categories: create, list, delete. Store `todos.txt` content as a text column.
- Serve and accept `todos.txt` format — via authenticated routes and public webhook.
- Public webhook: `GET/POST/PUT /w/:ulid` — read/append/replace todos (no auth).
- Quota consumption: each webhook write (POST/PUT) consumes one quota unit. Reads (GET) are free.
- Weekly quota reset job (`scripts/reset-quota-weekly.ts`).
- Legendum link/unlink via Legendum middleware.

---

## 5. Quota & billing

### Quota pools

- **quota_basic**: Free tier. 100 per 7-day rolling window. Reset by `scripts/reset-quota-weekly.ts` (run hourly via cron).
- **quota_extra**: Extra credits (default 0). Can be granted manually.
- **Legendum credits**: If user has `legendum_token` linked, charge 1 credit per webhook write when quota exhausted.

### Consumption

- **Webhook writes** (POST/PUT on `/w/:ulid`) consume 1 quota unit.
- **Webhook reads** (GET on `/w/:ulid`) are free and unlimited.
- **Authenticated API calls** do not consume quota.

### Flow

1. Check `quota_basic + quota_extra > 0`.
2. If yes: decrement basic first, then extra.
3. If no, and user has `legendum_token`: charge 1 Legendum credit.
4. If no credits: return 429 (quota exceeded).

---

## 6. API (REST)

**Auth**: All authenticated endpoints accept **cookie** (browser; encrypted) or **Authorization: Bearer \<token\>** (Legendum account key).

### Auth & Legendum

- `GET /t/auth/login` — redirect to Legendum authorization URL.
- `GET /t/auth/callback` — exchange code for user info; create/update user; set cookie.
- `POST /t/auth/logout` — unset session cookie.
- `/t/legendum/*` — handled by Legendum middleware (link/unlink/billing widget).

### Content negotiation

All category routes support multiple response formats:

- **HTML** — default for browsers (`Accept: text/html` or no extension). Returns the full PWA page.
- **Text** — `Accept: text/plain` or `.txt` extension (e.g. `GET /shopping.txt`). Returns `todos.txt` format.
- **JSON** — `Accept: application/json` or `.json` extension.
- **YAML** — `Accept: application/yaml` or `.yaml` extension.
- **Markdown** — `Accept: text/markdown` or `.md` extension.

### Categories & todos (auth)

- `GET /` — list all categories. Sorted by `position`.
- `POST /` — create category. Body: `name` (required). Returns category with webhook URL.
- `GET /:category` — get todos in category. Returns `todos.txt` format (or other format via content negotiation).
- `POST /:category` — append todos. Body: `todos.txt` format lines to add.
- `PUT /:category` — replace all todos. Body: full `todos.txt` content. This is the primary write API — the server diffs against current state and applies changes.
- `DELETE /:category` — delete category and all its todos.

### Settings

- `GET /t/settings/me` — return email, quota_basic, quota_extra, quota_reset, legendum_linked.

### Public webhook (no auth, no API key)

The webhook URL is the only credential needed. No API keys, no bearer tokens. This is intentional:
- Multiple agents may need access to the same category
- Accidental exposure is low-risk (scoped to one category of todos)
- Every project already has a `.env` — just add `TODOS_WEBHOOK`
- Webhooks are simple and category-scoped by design

Endpoints:

- `GET /w/:ulid` — get todos. Returns `todos.txt` format. **Free, no quota consumed.**
- `POST /w/:ulid` — append todos. Body: `todos.txt` format lines to add. **Consumes 1 quota.**
- `PUT /w/:ulid` — replace all todos. Body: full `todos.txt` content. **Consumes 1 quota.**

Shared responses: **404** if category not found; **429** if quota exceeded.

### Server-Sent Events (SSE)

- `GET /w/:ulid/events` — SSE stream for a category (no auth, same access as webhook). The web UI uses this too (it knows the ULID from the category).

When todos change via any source (web UI, webhook, CLI), the server broadcasts the updated `todos.txt` to all connected SSE clients.

Event format:
```
event: update
data: [ ] Buy milk
data: [x] Fix bug #42
data: [ ] Deploy to prod
```

This lets the web UI update in real time as agents work on todos via the webhook.

---

## 7. Security / privacy

- **Auth cookie**: Encrypted with HMAC-SHA256 server secret. Client cannot read or forge it.
- **No API keys**: Webhook URLs are the sole access mechanism for external/agent usage. The ULID is unguessable (Crockford base32, 26 chars) and each URL is scoped to a single category.
- **CORS**: Open to `*` — webhook endpoints are intentionally public.
- **HTTPS only** in production.

---

## 8. Configuration

No config file required. All configuration via environment variables:

- `TODOS_DOMAIN` — default: `http://localhost:3030` (dev), `https://todos.in` (prod).
- `TODOS_DB_PATH` — default: `data/todos.db`.
- `TODOS_COOKIE_SECRET` — required in production.
- `LEGENDUM_API_KEY` — if set, enables Legendum auth/billing. If not set, self-hosted mode (no auth, no quota).

### .env (per-project, for CLI)

- `TODOS_WEBHOOK` — webhook URL for the `todos` CLI command.

---

## 9. App UX

**Look and feel**: Optimized for **vertical screen**, **cellphone-sized** (portrait, thumb-friendly). Primary use as a **PWA** (add to home screen). Desktop/tablet is secondary.

### 9.1 Categories list (main screen)

- **Top bar**: Left = app logo; middle = Quota (single number: basic + extra); right = Settings icon.
- **Body**: List of categories, ordered by user-defined **position** (drag to reorder). Each row shows category **name** and todo **count** (e.g. "3/7" = 3 done of 7).
- **"+"** button to create a new category.
- **Swipe left** on a category row reveals **Delete**.
- **Drag** a category up/down to reorder (updates `position`).
- **Tap** a category → navigate to its **todo list**.

### 9.2 Todo list (per category)

- **Back arrow** returns to categories list.
- **Category name** as header, with webhook URL copy button.
- **List of todos**: checkbox (done/undone), todo text. Ordered by `position`.
- **"+"** to add a new todo (inline input at bottom).
- **Swipe left** on a todo reveals **Delete**.
- **Tap** a todo to edit its text.
- **Drag** a todo up/down to reorder within the category (updates `position`).

### 9.3 Settings

- Log out.
- Legendum link/unlink (via Legendum widget).

---

## 10. PWA & service worker

- **workbox-build** (`generateSW()`) generates the service worker at build time.
- **cacheId** = app version from `package.json` — version bump invalidates all caches.
- **Build**: Clean `/public/dist/` → Bun bundle (content-hashed filenames) → `generateSW()`.
- **SW config**: `skipWaiting`, `clientsClaim`, `cleanupOutdatedCaches`, `navigateFallback: "/index.html"`.
- **Registration**: `updateViaCache: "none"`; reload page on `controllerchange`.
- **No FCM** — service worker handles caching only, not push.

---

## 11. Scripts & cron

- `scripts/reset-quota-weekly.ts` — reset `quota_basic` to 100 for users where `quota_reset` is ≥7 days old. Run hourly via cron.

---

## 12. Out of scope for v1

- Push notifications (use Alert service if needed).
- Teams or shared categories with multiple owners.
- Native mobile apps (PWA only).
- WebSockets (SSE is sufficient).
- Auth on webhook URLs (beyond URL obscurity).

---

## 13. Future developments

- **Alert integration**: Optionally notify via Alert service when todos are added/completed.
- **Native mobile apps**: Android and iOS via app stores.
- **Payment**: Buy extra quota via Legendum.
- **Sharing**: Share a category (read-only or read-write) with other users.
- **Recurring todos**: Todos that reset on a schedule.

---

## Checklist (implementation)

- [ ] **DB**: Create `data/todos.db` from schema.sql (users, categories). Two tables only.
- [ ] **Auth & Legendum**: Login/callback/logout via Legendum SDK; Legendum middleware for `/t/legendum/*`; link/unlink widget.
- [ ] **Categories & Todos API**: `GET/POST/DELETE /`, `GET/POST/PUT/DELETE /:category`. Content negotiation (HTML, text, JSON, YAML, Markdown). `todos.txt` stored as text column on categories.
- [ ] **Webhook**: `GET/POST/PUT /w/:ulid` — public read/append/replace in `todos.txt` format; quota on writes.
- [ ] **SSE**: `GET /w/:ulid/events` — broadcast updated `todos.txt` on any change.
- [ ] **Quotas & billing**: Weekly reset job. Legendum credit charging fallback.
- [ ] **Settings**: `GET /t/settings/me`; Legendum link/unlink via middleware.
- [ ] **Frontend — layout**: Top bar (logo, quota, settings); categories list ordered by position; mobile-first portrait PWA.
- [ ] **Frontend — screens**: Login; Categories list; Todo list per category; Settings; Create category.
- [ ] **Frontend — drag & drop**: Drag to reorder categories on main screen; drag to reorder todos within a category.
- [ ] **PWA**: workbox-build `generateSW()`; version-based cacheId; content-hashed bundles; clean dist on build.
- [ ] **CLI**: `todos` — reads `TODOS_WEBHOOK` from `.env`; list (default)/done/undo/del/first/last/open commands; position-based; bare text adds a todo. Syncs local `todos.txt`.
- [ ] **Agent skill**: `.claude/skills/todos.md` and `.cursorrules` — teach agents to use the `todos` CLI for task tracking.
- [ ] **Scripts**: `reset-quota-weekly.ts`.
