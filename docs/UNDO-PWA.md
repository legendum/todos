# Web app (PWA): document undo / redo — spec

This document extends [`docs/UNDO.md`](UNDO.md). That spec delivered **server-authoritative** full-markdown undo/redo (`undos` / `redos` stacks), **`POST /w/:ulid/undo`** / **`redo`** for webhooks/CLI, and explicitly deferred **authenticated shortcuts** and **web UI**. This file specifies the **PWA** work: replace the list header **share / download / export** control with **undo** and **redo**, backed by **cookie-authenticated API routes** (not the webhook URL).

---

## Goals

1. Remove the **share / export / download** control from the top-right of the list view (`TodoList` header) — all of it (Web Share API and blob download fallback).
2. Add **Undo** immediately to the **left** of **Redo** (reading left-to-right: **`[Undo] [Redo]`** in the same header slot).
3. Wire both actions to the **same stack semantics** as `docs/UNDO.md` §5–§6, via **authenticated** HTTP endpoints that reuse `applyUndo` / `applyRedo` from [`src/lib/listHistory.ts`](../src/lib/listHistory.ts).

Non-goals for this iteration:

- Keyboard shortcuts (optional follow-up).
- Exposing stack depth or “what will undo” previews.
- **Share, system share, or file download/export** of list markdown from the PWA (the current header control does all of the above today — remove it entirely; undo/redo replaces that affordance).

---

## UX / UI

**Location:** List screen header row — same area as today’s share control in [`src/web/components/TodoList.tsx`](../src/web/components/TodoList.tsx) (trailing actions beside the title / webhook strip).

**Controls:**

| Control | Placement | Primary action |
|--------|-----------|----------------|
| **Undo** | Left of Redo | `POST` authenticated **undo** for the current list (by **slug**). |
| **Redo** | Rightmost of the pair (replaces former share position) | `POST` authenticated **redo** for the current list. |

**Visual / interaction:**

- Reuse the existing **`header-icon-btn`** (or equivalent) pattern so the new buttons match **copy webhook** / previous share sizing and tap targets.
- **`aria-label`** (and `title` where helpful): e.g. “Undo last edit”, “Redo”.
- **Offline:** Same policy as other server-synced writes: when the app is offline (or lacks usable session in hosted mode), buttons should be **disabled** or no-ops with clear feedback — align with existing offline banner / `saveMarkdown` behavior in `TodoList`.
- **Loading / double-submit:** While a request is in flight, disable the triggering button (or both) to avoid overlapping history ops.
- **Errors**
  - **`409 Conflict`:** Empty stack (“Nothing to undo/redo”) or snapshot failed validation (per `docs/UNDO.md`). Show a short, non-blocking message (toast or inline banner) using the JSON **`message`** when present.
  - **`404`:** Treated like other list routes (should be rare in-app).
  - **`401` / auth:** Redirect or prompt re-login consistent with the rest of the app.

**Removal (done):** The share/download control was removed from the list header (`navigator.share`, `canShare` + `File`, blob `<a download>` fallback, `ShareIcon.tsx`). **No** dedicated export in the PWA — use **`GET /:slug.md`**, webhooks, or the CLI for raw markdown.

---

## API: authenticated undo / redo

### Why not the webhook from the browser?

The PWA already uses **session cookies** (`credentials: "include"`) for `GET`/`PUT` [`/${slug}.md`](../src/web/App.tsx) and related routes. Calling **`POST /w/:ulid/undo`** from the client would require embedding the secret webhook URL in JS or extra plumbing. **Slug + session** matches how the user opens a list and avoids exposing webhook capability to every page load.

### Routes

Add **`POST`only** routes (no `GET`), parallel to the webhook:

| Method | Path | Auth |
|--------|------|------|
| `POST` | `/:slug/undo` | Required in hosted mode; implicit user in self-hosted (same as other list routes). |
| `POST` | `/:slug/redo` | Same |

**Slug:** Same character class as existing list slugs (see `LIST_SLUG` / `matchListPath` in [`src/api/server.ts`](../src/api/server.ts)).

**Routing order:** Match **`/:slug/undo`** and **`/:slug/redo`** in **both** the self-hosted branch and the authenticated branch **before** falling through to generic list `GET`/`PUT`/`PATCH`/`DELETE` handling, analogous to registering **`/w/:ulid/undo`** before **`/w/:ulid`** ([`docs/UNDO.md`](UNDO.md) decisions table).

**Handler placement:** Implement in [`src/api/handlers/lists.ts`](../src/api/handlers/lists.ts) (or a small helper imported there) so list resolution is **`WHERE user_id = ? AND slug = ?`**, matching [`replaceTodos`](../src/api/handlers/lists.ts).

**Core logic (must match `docs/UNDO.md`):**

1. Load current row (`lists.text`, `id`, `ulid`, …) for that user and slug; **`404`** if missing (`reason: list` or existing JSON error convention).
2. Call **`applyUndo(row.id, row.text)`** or **`applyRedo(row.id, row.text)`**.
3. On **`ok: false`:** **`409`** + JSON **`{ error: "conflict", message: string }`** (same spirit as [`postWebhookUndo`](../src/api/handlers/webhook.ts) / `postWebhookRedo`).
4. On success:
   - **`broadcast(row.ulid, result.newText)`** — same as webhook undo/redo so per-list SSE clients update.
   - **`notifyListsChanged(userId)`** — same as authenticated `replaceTodos` so **`GET /`** summaries / `lists` SSE refresh.

**Billing:** **Do not** charge list/webhook write credits for these endpoints (same product rule as webhook undo/redo in `docs/UNDO.md`).

**Request body:** Empty; ignore body if present (mirror webhook).

### Success response shape

Recommend **`200`** with **JSON** body aligned with a successful **`replaceTodos`** response so the client can update local state in one roundtrip:

```json
{
  "name": "…",
  "slug": "…",
  "ulid": "…",
  "text": "…full markdown…",
  "total": 0,
  "done": 0,
  "updated_at": 1234567890
}
```

(`total` / `done` from [`countTodos`](../src/lib/todos.ts) on the new `text`.)

Alternative acceptable for a minimal first ship: **`200`** with **raw markdown** and **`X-Updated-At`**, identical to webhook success — then the PWA **`GET /${slug}.md`** refetch path still works. Prefer JSON if the client already merges PUT-style payloads into IndexedDB.

### CORS / cookies

Hosted responses go through existing **`addCors`** + **`requireAuthAsync`** patterns in [`src/api/server.ts`](../src/api/server.ts). Client calls: **`fetch(\`/${slug}/undo\`, { method: "POST", credentials: "include" })`** (and `/redo`).

---

## Client integration notes

1. **State refresh:** After success, set in-memory lines from returned **`text`** (or refetch `/${slug}.md`) and update **`saveMarkdown`** / mem cache (`markdownMemCache`) so the UI, offline store, and server agree (**`updated_at`** from response).
2. **SSE:** Because the server broadcasts like a normal write, other tabs/devices should already converge; no extra client work beyond existing listeners if any.
3. **Control labels:** Undo/redo use masked SVGs from [`public/undo-arrow.svg`](../public/undo-arrow.svg) / [`redo-arrow.svg`](../public/redo-arrow.svg) (see [`DocHistoryArrows.tsx`](../src/web/components/DocHistoryArrows.tsx)); no share or download UI.

---

## Testing checklist (additions to `docs/UNDO.md` §13)

- `POST /:slug/undo` / `redo` with valid session: round-trip with stacks; **`404`** for wrong slug / other user’s list.
- **`409`** when stack empty or validation fails; no DB mutation on validation failure.
- **`broadcast` + `notifyListsChanged`** invoked on success (manual or integration test).
- No billing / charge side effects on authenticated undo/redo.
- PWA: offline disables or errors cleanly; online shows **`409`** message when nothing to undo/redo.
- Self-hosted mode: same routes work without Legendum session (single local user).

---

## Doc cross-references

- Canonical stack rules: [`docs/UNDO.md`](UNDO.md) §3–§7, §9–§10.
- Existing webhook implementation: [`src/api/handlers/webhook.ts`](../src/api/handlers/webhook.ts) (`postWebhookUndo` / `postWebhookRedo`).
