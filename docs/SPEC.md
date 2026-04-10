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

### 2.1 Auth (Login and Link with Legendum)

1. **Login**: User clicks "Login with Legendum" → backend calls `requestLink()` then redirects to Legendum authorize URL via `authAndLinkUrl()` (login + service linking in one flow).
2. **Callback**: Legendum returns to `/auth/callback` with code + state → backend exchanges code for `{ email, linked, legendum_token }`.
3. **Session**: Backend creates/updates user in `users` table, sets encrypted session cookie (HMAC-SHA256, 30-day expiry).
4. **Logout**: `POST /auth/logout` → unset cookie.
5. **Auto-logout on unlink**: If the user unlinks todos in Legendum, the frontend detects the status change and automatically logs out.
6. **Legendum middleware**: All Legendum integration (login, linking, billing) uses the Legendum SDK (`src/lib/legendum.js`) and Legendum middleware for `/t/legendum/*` routes.

No passwords. The user's **email** (from Legendum) is the stable identity — it uniquely identifies the user across devices and re-links. The `legendum_token` is a billing token that may change on re-link; it is updated on every login but never used for identity.

### 2.2 Categories

1. **Dashboard** (after login): List of categories. "Create category" → user enters a name → we generate a unique ULID for the webhook URL.
2. **Web URL**: `todos.in/<name>` — authenticated, session-based. The category name is the route, scoped to the logged-in user. Names must be unique per user. Reserved names: `t`, `w` (rejected on category create).
3. **Webhook URL**: `todos.in/w/<ulid>` — public, no auth. For agents and scripts.
4. **Each category** contains an ordered list of todo items.

### 2.3 Todos

A todo is a line of text with a done state. That's it.

- **Format**: `[ ] Buy milk` (not done) or `[x] Buy milk` (done).
- **Position** = line number among todo lines (lines matching `[ ] ` or `[x] `). Position 1 is the first todo.
- **No slugs, no IDs** in the external API. Todos are addressed by position or by their full text content.

### 2.4 The `todos.txt` format

The canonical format for reading and writing todos. Used by the CLI, the webhook API, and content-negotiated responses.

```
## Sprint 3
Context: shipping by Friday

[ ] Buy milk
[x] Fix bug #42
[ ] Deploy to prod

## Backlog
[ ] Refactor middleware
```

Rules:
- Lines starting with `[x] ` are done; lines starting with `[ ] ` are not done. These are "todo lines."
- All other lines (headings, blank lines, notes, context) are **free-form text** — preserved as-is, never modified by the server or CLI.
- Order = priority. First todo line is most important.
- Todo **position** is counted among todo lines only (skipping free-form text). Position 1 = first todo line in the document.

Limits:
- **Max document size**: 10 KB.
- **Max todo lines**: 200 per category.

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
  1. **Union**: combine server and local todo lines, de-dup by exact text match. Free-form text lines are preserved from whichever side has them.
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
- `GET /:category` — get todos (returns `todos.txt` format, or JSON via content negotiation)
- `PUT /:category` — replace all todos (body is full `todos.txt` content)
- `POST /:category` — same as PUT (replace all)
- `DELETE /:category` — delete the category

Responses support `.json`, `.txt` extensions for format selection. See `docs/todos.yaml` for the chats2me tool manifest.

---

## 3. Data we store (minimal)

**Hierarchy:** A user has categories; a category has todos.

- **users**: `id` (PK), `email` (UNIQUE, NOT NULL — stable identity from Legendum; `local@localhost` for self-hosted), `legendum_token` (account-service token for billing — updated on each login), `created_at`.
- **categories**: `id` (PK, INTEGER auto-increment), `user_id` (FK), `ulid` (UNIQUE, for webhook URL `/w/:ulid`), `name`, `position` (INTEGER, for user-defined ordering), `text` (TEXT, the raw `todos.txt` content), `created_at`.

That's it. Two tables. The `text` column stores the canonical `todos.txt` content — the server doesn't parse it into rows.

Schema: see `config/schema.sql`.

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
- **Self-hostable**: MIT license. Single binary (Bun), SQLite database. No config file required — just `bun run src/api/server.ts` with sensible defaults. If `LEGENDUM_API_KEY` is not set, assume self-hosted mode: skip Legendum auth/billing, no size or todo limits, and serve todos without login. Install globally via `bun link`.

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
    constants.ts    # PORT, HOST
    mode.ts         # isByLegendum(), isSelfHosted()
    db.ts
    legendum.js
public/             # Static assets (logo, manifest, dist/)
  todos.png
scripts/
docs/
  CONCEPT.md
  SPEC.md
  todos.yaml        # chats2me tool manifest
config/
  schema.sql
  nginx.conf
package.json        # bin: { "todos": "src/cli/main.ts" }
biome.json
tsconfig.json
```

### Backend responsibilities

- Legendum OAuth login flow via Legendum SDK and middleware.
- Categories: create, list, delete. Store `todos.txt` content as a text column.
- Serve and accept `todos.txt` format — via authenticated routes and public webhook.
- Public webhook: `GET/POST/PUT /w/:ulid` — read/append/replace todos (no auth).
- Billing via Legendum tabs: category creation and webhook writes charged via tabs.
- Legendum link/unlink via Legendum middleware.

---

## 5. Billing (Legendum tabs)

All billing goes through **Legendum tabs** — no local quota tracking.

### Costs

- **Category creation**: 2 credits.
- **Webhook write** (PUT/POST on `/w/:ulid`): 0.1 credits.
- **Reads** (GET on any endpoint): free.
- **Authenticated writes** (PUT/POST on `/:category`): free (user is already paying for Legendum).

### Tabs

Legendum tabs allow micro-charges to accumulate until a threshold is reached, then settle as a single charge.

- **Tab threshold**: 2 credits. When the running tab reaches 2 credits, it is charged to the user's Legendum account.
- Tabs are managed by the Legendum SDK — the server calls `legendum.tabs.add(userId, amount, description)` and the SDK handles accumulation and settlement.

### Flow

1. User must have `legendum_token` linked to create categories or write via webhook.
2. On category create: add 2 credits to the user's tab.
3. On webhook write: add 0.1 credits to the user's tab.
4. If the user has no linked Legendum account: return 402 (payment required).
5. If the Legendum charge fails: return 429.

### Self-hosted mode

When `LEGENDUM_API_KEY` is not set, all billing is disabled — no charges, no limits on document size or todo count. Everything is free and unlimited.

---

## 6. API (REST)

**Auth**: All authenticated endpoints accept **cookie** (browser; encrypted) or **Authorization: Bearer \<token\>** (Legendum account key).

### Auth & Legendum

- `GET /auth/login` — login and link via Legendum (requestLink + authAndLinkUrl redirect).
- `GET /auth/callback` — exchange code for user info; create/update user; set cookie.
- `POST /auth/logout` — unset session cookie.
- `/t/legendum/*` — handled by Legendum middleware (link/unlink/billing widget).

### Content negotiation

All category routes support multiple response formats:

- **HTML** — default for browsers (`Accept: text/html` or no extension). Returns the full PWA page.
- **Text** — `Accept: text/plain` or `.txt` extension (e.g. `GET /shopping.txt`). Returns `todos.txt` format.
- **JSON** — `Accept: application/json` or `.json` extension.

### Categories & todos (auth)

- `GET /` — list all categories. Sorted by `position`.
- `POST /` — create category. Body: `name` (required). Returns category with webhook URL.
- `GET /:category` — get todos in category. Returns `todos.txt` format (or other format via content negotiation).
- `PUT /:category` — replace all todos. Body: full `todos.txt` content. The server stores it verbatim.
- `POST /:category` — same as PUT (replace all). Both accept the full document.
- `DELETE /:category` — delete category and all its todos.

### Settings

- `GET /t/settings/me` — return legendum_linked.

### Public webhook (no auth, no API key)

The webhook URL is the only credential needed. No API keys, no bearer tokens. This is intentional:
- Multiple agents may need access to the same category
- Accidental exposure is low-risk (scoped to one category of todos)
- Every project already has a `.env` — just add `TODOS_WEBHOOK`
- Webhooks are simple and category-scoped by design

Endpoints:

- `GET /w/:ulid` — get todos. Returns `todos.txt` format. **Free, no quota consumed.**
- `PUT /w/:ulid` — replace all todos. Body: full `todos.txt` content. **Costs 0.1 credits (via tab).**
- `POST /w/:ulid` — same as PUT (replace all). **Costs 0.1 credits (via tab).**

Shared responses: **404** if category not found; **402** if no Legendum account linked; **429** if charge fails.

### Server-Sent Events (SSE)

- `GET /w/:ulid/events` — SSE stream for a category (no auth, same access as webhook). The web UI uses this too (it knows the ULID from the category).

When todos change via any source (web UI, webhook, CLI), the server broadcasts the updated `todos.txt` to all connected SSE clients.

Event format:
```
event: update
data: ## Sprint 3
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

- `PORT` — default: `3000`. Server listen port.
- `HOST` — default: `0.0.0.0`. Server bind host.
- `TODOS_DOMAIN` — default: `http://localhost:${PORT}` (dev), `https://todos.in` (prod).
- `TODOS_DB_PATH` — default: `data/todos.db`.
- `TODOS_COOKIE_SECRET` — required in hosted mode.
- `LEGENDUM_API_KEY` — if set, enables hosted mode (Legendum auth/billing). If not set, self-hosted mode (no auth, no quota). This is the sole signal for hosted vs self-hosted — no `NODE_ENV` needed.
- `LEGENDUM_SECRET` — required when `LEGENDUM_API_KEY` is set.
- `LEGENDUM_BASE_URL` — default: `https://legendum.co.uk`.

### .env (per-project, for CLI)

- `TODOS_WEBHOOK` — webhook URL for the `todos` CLI command.

---

## 9. App UX

**Look and feel**: Optimized for **vertical screen**, **cellphone-sized** (portrait, thumb-friendly). Primary use as a **PWA** (add to home screen). Desktop/tablet is secondary.

### 9.1 Categories list (main screen)

- **Top bar**: Left = app logo; right = Settings icon.
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
- Legendum link/unlink (via Legendum widget). Unlinking auto-logs out.

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

No cron jobs needed — billing is handled by Legendum tabs.

---

## 12. Out of scope for v1

- Push notifications (use Alert service if needed).
- Teams or shared categories with multiple owners.
- Native mobile apps (PWA only).
- WebSockets (SSE is sufficient).
- Auth on webhook URLs (beyond URL obscurity).

---

## 13. Future developments

- **Email notifications**: User email is stored, enabling future transactional email (e.g. daily digest, todo reminders).
- **Alert integration**: Optionally notify via Alert service when todos are added/completed.
- **Native mobile apps**: Android and iOS via app stores.
- **Payment**: Adjustable pricing tiers via Legendum.
- **Sharing**: Share a category (read-only or read-write) with other users.
- **Recurring todos**: Todos that reset on a schedule.

---

## Checklist (implementation)

- [x] **DB**: Create `data/todos.db` from config/schema.sql (users, categories). Two tables only.
- [x] **Auth & Legendum**: Login-and-link/callback/logout via Legendum SDK; Legendum middleware for `/t/legendum/*`; link/unlink widget; auto-logout on unlink.
- [x] **Categories & Todos API**: `GET/POST/DELETE /`, `GET/PUT/POST/DELETE /:category`. PUT and POST both replace full content. Content negotiation (HTML, text, JSON). `todos.txt` stored as text column on categories.
- [x] **Webhook**: `GET/PUT/POST /w/:ulid` — public read/replace in `todos.txt` format; PUT and POST identical; quota on writes.
- [x] **SSE**: `GET /w/:ulid/events` — broadcast updated `todos.txt` on any change.
- [x] **Billing**: Legendum tabs — 2 credits per category create, 0.1 per webhook write, 2-credit tab threshold. No billing in self-hosted mode.
- [x] **Settings**: `GET /t/settings/me`; Legendum link/unlink via middleware; auto-logout on unlink.
- [x] **Frontend — layout**: Top bar (logo + install dialog); categories list ordered by position; mobile-first portrait PWA.
- [x] **Frontend — screens**: Login; Categories list; Todo list per category; Install dialog.
- [x] **Frontend — drag & drop**: Drag to reorder categories on main screen; drag to reorder todos within a category.
- [x] **PWA**: workbox-build `generateSW()`; version-based cacheId; content-hashed bundles; clean dist on build.
- [x] **CLI**: `todos` — reads `TODOS_WEBHOOK` from `.env`; list (default)/done/undo/del/first/last/open/skill commands; position-based; bare text adds a todo. Syncs local `todos.txt`.
- [x] **Agent skill**: `todos skill` installs `.claude/skills/todos.md` and `.cursor/rules/todos.mdc`.
