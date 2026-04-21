# Lists rename — spec

Rename **categories → lists** throughout the codebase. A "list" is a named todo list with a unique webhook URL — the same concept as a category, just a clearer word. This is a terminology-only change; behaviour and URLs don't change.

**Why**: `SPEC.md` already describes a category as "a named todo list". The shorter noun is more natural, makes the `Mindmaps` analogy cleaner (there: "mindmap"; here: "list"), and reads better in UI copy ("No todo lists yet" → keeps, is accurate; source code stops having to translate between "category" and "list").

---

## 1. Scope

**Zero-tolerance rule**: after this change the string `category` / `categories` (any casing) must not appear **anywhere** in the repo — no filenames, no type names, no variable names, no table/column/index names, no comments, no user-facing copy, no test names, no docstrings, no log messages, no JSON keys, no HTTP headers, no docs prose.

**Sole permitted exceptions** (documented, grep-able, intentional):

1. `config/migrate-categories-to-lists.sql` — the migration file's filename and its one `ALTER TABLE categories RENAME TO lists` statement. This is the only place in the codebase where the old name legitimately still has to be spelled.
2. `docs/LISTS.md` — this doc, which describes the rename.
3. Git history (commit messages, blame) — untouched.

Anywhere else — including ancillary comments like "used to be categories" — the word must go. If a reader needs context for why something was renamed, the commit message or this doc is where they look; don't leave breadcrumbs in code.

**Verification gate** (part of acceptance, §5): a single grep covers this.

```
rg -i --hidden -g '!.git' -g '!docs/LISTS.md' -g '!config/migrate-categories-to-lists.sql' 'categor'
```

Must return **zero hits**. Anything else in that output is a bug in the rename PR.

### 1.1 Mechanical renames

| Old | New |
|---|---|
| `category`, `categories` (identifier, variable, type) | `list`, `lists` |
| `CategoryListEntry` (type) | `ListEntry` |
| `CategoryRow` | `ListRow` |
| `TodoCategoryJson` | `TodoListJson` |
| `patchCategoryName` | `patchListName` |
| `categoryFromTodoJson` / `categoryFromJson.ts` | `listFromTodoJson` / `listFromJson.ts` |
| `seedDefaultCategoriesForNewUser` / `seed-default-categories.ts` | `seedDefaultListsForNewUser` / `seed-default-lists.ts` |
| `CategoriesList` component / file | `Lists` component / file (`components/Lists.tsx`) |
| `src/api/handlers/categories.ts` | `src/api/handlers/lists.ts` |
| `listCategories`, `createCategory`, `renameCategory`, `deleteCategory`, `reorderCategories` handlers | `indexLists`, `createList`, `renameList`, `deleteList`, `reorderLists`. (`indexLists` avoids the awkward `listLists`.) |
| `"categoriesList"` IndexedDB meta key | `"lists"` |
| `seed-default-categories.ts` seed data, any docstring use of "category" | "list" |

### 1.2 SQL / database

- Table `categories` → `lists`.
- Indexes `idx_categories_*` → `idx_lists_*`.
- All column names stay identical (`id`, `user_id`, `ulid`, `name`, `slug`, `position`, `text`, `created_at`, `updated_at`).
- **End state**: exactly **two tables** — `users`, `lists`. No `schema_migrations` / bookkeeping table. The migration runs at most once because its precondition (the old `categories` table exists) stops being true after it runs.
- Migration strategy: one SQL file + a six-line conditional in `src/lib/db.ts`. See §3.

### 1.3 API surface

Routes and response shapes are **unchanged** (the rename is purely a server-internal renaming of the table and identifiers); however, three externally-visible strings change:

| Surface | Old | New |
|---|---|---|
| `GET /` JSON response body key | `{ categories: [...] }` | `{ lists: [...] }` |
| Webhook response header | `X-Category-Slug`, `X-Category-Name` | `X-List-Slug`, `X-List-Name` |
| `error.reason` fields | `"category"` | `"list"` |
| Error messages | `A category with URL "…" already exists` | `A list with URL "…" already exists` |
| Duplicate-on-rename error | same | same noun change |

**No compatibility aliases.** This is a pre-scale project; a clean cutover is simpler than dual-emitting. The CLI is in-repo and gets updated in the same PR. Any external agent with a hard-coded `X-Category-Slug` fallback is already reading from our repo's `SKILL.md`, which we'll update.

### 1.4 URLs — unchanged

- `todos.in/<slug>` — unchanged.
- `todos.in/w/<ulid>` — unchanged.
- `PATCH /t/reorder` — unchanged route name (the `t` prefix is for "todos-app internal" routes, not "categories"; leave it).
- Reserved slugs stay `t` and `w`. We do **not** add `lists` to the reserved set — there's no `/lists` listing page; `/` is the home.

### 1.5 Frontend copy

- Home screen title, empty states, filter placeholder — already say "todo lists" or are neutral. Quick sweep to make sure nothing reads "category" to the user.
- Install dialog / about text / help strings — grep and update.
- CLI help text — `category` appears in `todos open` output context; update.

### 1.6 Docs

- `docs/SPEC.md` §2.2, §2.3, §2.6, §2.7 — rename throughout.
- `docs/CONCEPT.md` — rename.
- `docs/FIXES.md` — rename (the "filter the category list" fix text still reads fine as "filter the list list"... no. Rephrase to "filter the home-screen lists").
- `config/SKILL.md` — rename (agents read this).
- `README.md` — rename.

### 1.7 Tests

- `tests/api.test.ts` — rename test titles ("creates a category" → "creates a list"), response-body assertions (`body.categories` → `body.lists`), header assertions (`X-Category-*` → `X-List-*`).
- All other test files: sweep.

---

## 2. Files affected (survey)

Grep `/\b[Cc]ategor/` returns ~270 hits across 27 files. Touch every one. The non-obvious spots:

- `src/web/offlineDb.ts` — IndexedDB meta key `"categoriesList"`. Cache migration needed (see §4).
- `src/lib/sse.ts` — channel name may reference `category`.
- `src/lib/billing.ts` — credit-spend rows referencing `category`.
- `src/web/components/InstallDialog.tsx` — user-facing copy.
- `src/cli/main.ts` — reads `X-Category-Slug` response header.
- `src/api/handlers/webhook.ts` — sets `X-Category-Slug` / `X-Category-Name` response headers.
- `src/api/auth-middleware.ts` — any references.
- `src/api/handlers/auth.ts` — seeds default categories.

---

## 3. Database migration

**One SQL file** — `config/migrate-categories-to-lists.sql` — handles the rename. No migrations table; idempotency comes from the migration's own precondition (it looks for `categories` and only runs if found). After it runs, `categories` no longer exists, so subsequent boots skip it. Final state is exactly two tables: `users`, `lists`.

### 3.1 `config/schema.sql` — new canonical schema

Rewrite to reference `lists`, not `categories`. This file continues to be executed on every boot with `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` — idempotent for fresh installs, a no-op after the migration has run on existing DBs.

```sql
CREATE TABLE IF NOT EXISTS lists (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  ulid       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  text       TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_lists_user       ON lists(user_id);
CREATE INDEX IF NOT EXISTS idx_lists_ulid       ON lists(ulid);
CREATE INDEX IF NOT EXISTS idx_lists_user_slug  ON lists(user_id, slug);
```

### 3.2 `config/migrate-categories-to-lists.sql` — the one-shot rename

This file (and its filename) is one of the two permitted places in the repo where `categor` is allowed to survive — it *is* the rename (see §1 zero-tolerance rule). No other SQL, code, or comment should refer to the old name.

```sql
ALTER TABLE categories RENAME TO lists;

DROP INDEX IF EXISTS idx_categories_user;
DROP INDEX IF EXISTS idx_categories_ulid;
DROP INDEX IF EXISTS idx_categories_user_slug;

CREATE INDEX IF NOT EXISTS idx_lists_user       ON lists(user_id);
CREATE INDEX IF NOT EXISTS idx_lists_ulid       ON lists(ulid);
CREATE INDEX IF NOT EXISTS idx_lists_user_slug  ON lists(user_id, slug);
```

Notes:
- A fresh install never executes this: `categories` doesn't exist, so the gate in db.ts skips the file. `schema.sql` creates `lists` directly.
- An existing install runs it once: `ALTER TABLE` moves the data atomically. On the next boot, `categories` no longer exists, so the gate skips. No bookkeeping table required.

### 3.3 Migration step — `src/lib/db.ts`

```ts
function migrateCategoriesToLists(): void {
  const hasCategories = db!
    .query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='categories'")
    .get();
  if (!hasCategories) return;

  const sql = readFileSync(
    join(ROOT_DIR, "config/migrate-categories-to-lists.sql"),
    "utf-8",
  );
  db!.transaction(() => db!.exec(sql))();
}

// Order of operations in getDb():
//   1. migrateCategoriesToLists()   — rename in place if the old table exists
//   2. runSchema()                   — ensure current schema (lists + indexes)
```

That's the whole runner. No migrations table, no bookkeeping — the precondition (`categories` exists) gates the run, and running flips that precondition to false.

**Rationale for this order**: migration first, `schema.sql` second. Fresh install: no `categories`, migration is a no-op, `schema.sql` creates `lists`. Existing install: migration renames, `schema.sql`'s `CREATE TABLE IF NOT EXISTS lists` is a no-op.

If a future change ever needs a real migration framework, introduce one then. For now, two tables total, one conditional in code.

### 3.4 Rollback

Out of scope. If this lands and we need to undo, restore from the WAL backup (`data/todos.db-wal`) or a cold `.db` copy. The migration is a rename, not a data transform — no information is lost in the forward direction, but we don't write a reverse migration.

### 3.5 What to do with existing DBs in-tree

- `data/todos.db` — dev database, will migrate on next boot. Verify with `sqlite3 data/todos.db ".schema lists"` after boot.
- `data/test-todos.db` — test database. Delete before running the test suite (`rm data/test-todos.db*`) so it re-creates cleanly on the new schema.

---

## 4. Client-side cache

`src/web/offlineDb.ts` currently writes the list-of-lists into IndexedDB under the meta key `"categoriesList"`. After the rename:

- New code writes/reads under the key `"lists"`.
- The old `"categoriesList"` entry stays in users' IndexedDB as orphan data. Deliberately **no cleanup step** — writing one would require the word `"categoriesList"` to appear in `src/`, which breaks the §1 zero-tolerance rule. The orphan is a few KB at most and never read; it can age out the next time we have an unrelated reason to bump an IDB version.

Markdown-per-slug rows (keyed by the list slug itself) don't change key shape — no migration needed.

---

## 5. Rollout

This is a single-commit / single-PR change. The ordering inside the commit:

1. SQL: add `config/migrate-categories-to-lists.sql`; rewrite `config/schema.sql` to `lists`.
2. `src/lib/db.ts`: add `migrateCategoriesToLists()`, wire it ahead of `runSchema()`.
3. Server: rename `handlers/categories.ts` → `handlers/lists.ts`, rename functions and types, update `server.ts` imports and the one response-header strings in `webhook.ts`.
4. Seeds: rename `seed-default-categories.ts` → `seed-default-lists.ts`.
5. CLI: update `X-Category-Slug` → `X-List-Slug` read in `main.ts`.
6. Web: rename types (`CategoryListEntry` → `ListEntry`), component (`CategoriesList` → `Lists`), helper files (`patchCategoryName` → `patchListName`, `categoryFromJson` → `listFromJson`).
7. IndexedDB: rename meta key and add the one-shot `"categoriesList"` cleanup.
8. Tests: sweep `tests/api.test.ts` response-body and header assertions; update test titles.
9. Docs: `SPEC.md`, `CONCEPT.md`, `README.md`, `FIXES.md`, `config/SKILL.md`.
10. Smoke: `bun run smoke` (lint + tests + build).

Acceptance:
- Fresh install boots, creates `lists` table, no `categories` references anywhere.
- Existing dev DB migrates: `sqlite3 data/todos.db ".tables"` shows exactly `users` and `lists`, no `categories`, no bookkeeping table.
- `GET /` returns `{ lists: [...] }`.
- Webhook `GET` returns `X-List-Slug` / `X-List-Name`; old headers are gone.
- CLI `todos open` still works (it reads the renamed header).
- `bun run smoke` green.
- **Zero-tolerance grep** (§1) returns 0 hits across the whole repo, with the only allowed paths being `config/migrate-categories-to-lists.sql` and `docs/LISTS.md`.

---

## 6. Non-goals

- No behaviour change, no URL change, no new features.
- No backwards-compatibility aliases for the renamed API fields / headers.
- No reversible migration.
- No rename of the unrelated `/t/*` route prefix — that's about the app namespace, not categories.
- No data re-shape (column names, types, relationships stay identical).
