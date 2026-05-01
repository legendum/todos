# Document-level undo / redo (spec)

This document specifies **full-markdown undo and redo** for a single list’s `lists.text` column: rewinding or replaying the entire `todos.md` document as stored on the server. It is separate from **per-task** “mark not done” in the CLI: **`todos todo <n>`** (§2).

---

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| CLI document commands | **`todos undo`** and **`todos redo`** (no arguments). |
| Storage | Two tables: **`undos`** (undo stack) and **`redos`** (redo stack), same column layout, **max 10 rows each** per `list_id` (see §3.1, §15). |
| CLI ↔ server | **`todos undo` / `todos redo` call the list webhook** — no session cookie or separate API auth path for this feature. |
| Empty document | **Undo may restore `''`.** Redo can bring back content after that. Snapshots include empty text when it is the prior body. |
| Line endings / dedup (old Q5) | **Byte-identical compare only:** no CRLF normalization for dedup—whatever bytes were saved are what get compared. If clients normalize before send, behavior follows naturally. |
| Auth surface | **Webhook-only** for undo/redo as specified here (CLI). Authenticated REST shortcuts for the web app are optional later but not required by this spec. |
| Agent skill | **`config/SKILL.md`:** update when commands ship so agents see **`todos todo`**, **`todos undo`**, **`todos redo`**. |
| Lists per user (abuse / capacity) | **Max 50 lists per `user_id`.** With **200 todo lines per list** (see `docs/SPEC.md`), that is at most **10,000 todo lines** across all lists for one account. Enforce on **`POST /`** (create list) before charging / inserting. |
| History rows per user (abuse / capacity) | With **10** rows max per stack per list: **50 × 10 = 500** max rows in **`undos`** per user and **500** in **`redos`** (**1,000** history rows total at full caps). |
| HTTP errors | Prefer **`403`** / **`409`** over **`400`** when semantics fit. Avoid **`400`** unless there is no better status. |
| Billing (webhook undo/redo) | **Free** — do **not** call **`chargeWebhookWrite`** (or equivalent) on **`POST /w/:ulid/undo`** / **`redo`**. |
| Validation after undo/redo | Run the **same** markdown validation as webhook **`PUT`** (e.g. **`validateTodosText`**) on the body **before** committing. If it fails (e.g. snapshot no longer passes current rules), abort and respond **`409`** + JSON **`message`**. |
| Webhook verbs | **`POST`** only for **`/undo`** / **`redo`** (no **`GET`**). |
| Route registration | Match **`/w/:ulid/undo`** and **`/w/:ulid/redo`** **before** generic **`/w/:ulid`** so paths are not swallowed. |
| Web UI | **No** undo/redo in the web app **at this time** (CLI + webhook only). |

The service is **pre-production**; breaking CLI changes are acceptable — no backwards compatibility or migration playbook.

---

## 15. Product limits (lists — abuse / capacity)

This section is **not** part of undo/redo mechanics; it is documented here so implementation work on stacks and on **`createList`** can ship with a single coherent spec.

**Why caps exist:** Webhooks and inexpensive writes mean a single actor could otherwise force **unbounded** SQLite growth (many lists, huge markdown bodies, deep snapshot stacks). Hard limits bound **disk**, **query cost**, and **index cardinality** per account — i.e. reduce **DoS-style abuse** (storage exhaustion, pathological `COUNT`/prune work) without pretending to solve all attack surfaces.

- **Max lists per user:** **50** (count rows in **`lists`** for that **`user_id`** before insert).
- **Combined with existing per-list cap:** **200 todo lines** per list ⇒ worst-case **50 × 200 = 10,000** todo lines per user (ignoring free-form markdown lines).
- **Undo/redo stacks:** **10** rows max in **`undos`** per list and **10** in **`redos`** per list ⇒ **50 × 10 = 500** max **`undos`** rows per user and **500** max **`redos`** (**1,000** history rows total when every list’s stacks are full). **That combined ceiling is intentional and sufficient** for normal use and DoS-style abuse bounds; no need to raise it without new requirements.
- **Response when at list cap:** **`403`** with a clear JSON **`message`** (e.g. “List limit reached (50 per account)”). Prefer **`403`** over **`400`** per HTTP policy above.
- **Webhook / CLI:** cannot create lists — only **`POST /`** — so the list cap is enforced in one place (`createList`).

Self-hosted vs hosted: these caps are partly **anti-abuse / anti-DoS** bounds (resource amplification); if self-hosted builds relax document limits, they should still apply **list and stack caps** unless the operator explicitly forks behavior — otherwise a single misbehaving client can still spam **`lists`** / **`undos`** / **`redos`** rows.

---

## 1. Motivation

- Users (and agents) can make large or accidental edits to a list’s markdown. A bounded server-side history makes it possible to recover without restoring from backups.
- The web app, webhook `PUT`, authenticated `PUT /:slug`, and CLI `PUT` should all feed the same snapshot rules so stacks stay coherent.

---

## 2. CLI naming

**Per-task “mark not done”:** **`todos todo <n> [...]`**

```text
todos todo <n> [...]     mark position(s) not done
```

**Document-level history:**

```text
todos undo               revert entire markdown one step (webhook)
todos redo               replay one step forward after undo (webhook)
```

These must not overload the same primary verb (per-task uses **`todo`**; document uses **`undo`** / **`redo`**).

---

## 3. Storage: `undos` and `redos`

Append-only rows; rows are never updated. Two parallel tables with identical shape.

| Column | Type | Notes |
|--------|------|--------|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | Stable ordering for “newest” (`MAX(id)` per stack). |
| `list_id` | `INTEGER NOT NULL` | References `lists(id)`. |
| `text` | `TEXT NOT NULL` | Full document snapshot (`''` allowed — empty list). |
| `created_at` | `INTEGER NOT NULL` | Unix epoch seconds. No `updated_at`. |

**Foreign keys**

```sql
list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE
```

**Indexes (recommended)**

```sql
CREATE INDEX IF NOT EXISTS idx_undos_list_id_id ON undos(list_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_redos_list_id_id ON redos(list_id, id DESC);
```

### 3.1 Cap: 10 rows per stack per list

After each **insert** into **`undos`** or **`redos`** for a given `list_id`, delete older rows until **10** remain (keep largest `id`). Run pruning in the **same transaction** as the inserts/updates that touch `lists.text` or stack pops.

---

## 4. Snapshot on normal edit (`lists.text` replace)

Whenever **`lists.text`** changes from **`old`** → **`new`** via a **content replace** path — i.e. anything that **fully replaces** the markdown **except** the dedicated **undo** / **redo** handlers (§5–§6), including **webhook** **`PUT`/`POST /w/:ulid`** and **authenticated** **`PUT`/`POST /:slug`**:

1. If **`new`** is **byte-identical** to **`old`**, no-op (no `lists` update, no stack writes).
2. Otherwise, in one transaction:
   - **`INSERT INTO undos (list_id, text, created_at)`** with **`text = old`** (may be `''`).
   - **Prune `undos`** for this `list_id` to 10 rows.
   - **`DELETE FROM redos WHERE list_id = ?`** — new edits discard redo history (standard editor behavior).
   - **`UPDATE lists`** set `text = new`, bump `updated_at`.
3. Notify SSE / list subscribers like today’s `PUT`.

**Write paths that must participate**

- Authenticated `PUT` / `POST` `/:slug` (full document replace).
- Webhook `PUT` / `POST` `/w/:ulid` (full document replace).

Any future API that replaces `lists.text` must follow the same snapshot + clear-redos rules.

---

## 5. Undo algorithm (server)

**Meaning:** Pop one generation from **`undos`** onto **`lists.text`**; push displaced current onto **`redos`**.

1. If **`undos`** has no row for this `list_id`, respond **`409 Conflict`** with JSON **`message`** — **nothing to undo**. (Prefer **`409`** over **`400`**.)

2. Let **`prev`** = `text` from the row with **`MAX(id)`** in **`undos`** for this `list_id`.

3. Let **`cur`** = current **`lists.text`**.

4. Validate **`prev`** with the **same** rules as webhook **`PUT`** (e.g. **`validateTodosText`**). If invalid, respond **`409`** + **`message`** and **do not** mutate stacks or **`lists`** (historical snapshot conflicts with current validation rules).

5. Transaction:
   - **Delete** that **`undos`** row.
   - **`UPDATE lists`** set `text = prev`, bump `updated_at`.
   - **`INSERT INTO redos (list_id, text, created_at)`** with **`text = cur`**.
   - **Prune `redos`** for this `list_id` to 10 rows.

6. Notify SSE / subscribers like a successful markdown write.

**Empty:** If **`prev`** is `''`, the list becomes empty; that is valid (validation must allow empty unless product rules say otherwise).

---

## 6. Redo algorithm (server)

**Meaning:** Pop one generation from **`redos`** onto **`lists.text`**; push displaced current onto **`undos`** (so you can undo a redo).

1. If **`redos`** has no row for this `list_id`, respond **`409 Conflict`** with JSON **`message`** — **nothing to redo**.

2. Let **`next`** = `text` from **`MAX(id)`** row in **`redos`** for this `list_id`.

3. Let **`cur`** = current **`lists.text`**.

4. Validate **`next`** with the **same** rules as webhook **`PUT`**. If invalid, respond **`409`** + **`message`** and **do not** mutate stacks or **`lists`**.

5. Transaction:
   - **Delete** that **`redos`** row.
   - **`UPDATE lists`** set `text = next`, bump `updated_at`.
   - **`INSERT INTO undos (list_id, text, created_at)`** with **`text = cur`**.
   - **Prune `undos`** for this `list_id` to 10 rows.

6. Notify SSE / subscribers like a successful markdown write.

---

## 7. Clearing redo on normal edit

Covered in §4: any **content replace** of **`lists.text`** (§4 paths), **excluding** §5–§6 only, clears **`redos`** entirely for that list.

---

## 8. Webhook API (CLI entrypoint)

**Security note:** Anyone who holds the webhook URL can already replace markdown via `PUT`; exposing **`undo`** / **`redo`** on the same capability URL extends that power in an obvious way. Acceptable for this product; document for operators.

**Routes** — **`POST` only** (safest default); extend webhook routing so these match **before** the generic **`/w/:ulid`** handler (otherwise **`undo`** / **`redo`** may be parsed as part of the ULID or misrouted):

| Method | Path | Behavior |
|--------|------|----------|
| `POST` | `/w/:ulid/undo` | Run §5; success **`200`** + body = new markdown (same `Content-Type` / `X-Updated-At` convention as webhook **`PUT`**). Empty stack → **`409`** + JSON. |
| `POST` | `/w/:ulid/redo` | Run §6; same response shape. |

**CLI:** Derive base webhook from **`TODOS_WEBHOOK`** (e.g. `https://host/w/01ARZ3NDEKTSV4RRFFQ69G5FAV`), then **`POST`** to `…/undo` or `…/redo` with **empty body** (or ignore body). No cookies.

**Billing:** **Undo/redo are free** — do **not** charge webhook-write credits / tabs for these endpoints (unlike **`PUT /w/:ulid`**).

**CORS:** Match existing webhook responses (`Access-Control-Allow-Origin`, etc.) so browser-based tools behave.

---

## 9. Web UI

**Out of scope for now:** no undo/redo controls in the web app; users rely on **CLI** (**`todos undo`** / **`todos redo`**) hitting the webhook routes above. A future iteration could call the same server helpers; stacks stay server-authoritative.

---

## 10. Interaction with SSE / offline clients

- Undo/redo should emit the same **`lists`** / markdown notifications as a successful `PUT`, so other tabs refresh.
- Offline IndexedDB conflict rules elsewhere apply; stacks live on the server.

---

## 11. Design tradeoffs (honest)

**Strengths**

- Full-document snapshots; straightforward SQLite transactions.
- Two stacks (`undos`, `redos`) match user expectations.

**Tradeoffs**

- Disk: up to **10 + 10** full copies per list plus current row.
- Rapid saves consume undo steps quickly unless edits dedupe (§4).
- Concurrent writers: interleaved history; last writer wins on `lists.text`.

---

## 12. Schema delivery

Update **`config/schema.sql`** with **`undos`** and **`redos`**. Pre-production: no separate migration deliverable.

---

## 13. Testing checklist

- Undo / redo with empty document states (`''` ↔ non-empty).
- Max depth: 11th push into **`undos`** drops oldest; same for **`redos`**.
- Normal `PUT` after undo clears **`redos`**.
- Redo pushes prior head onto **`undos`** so undo chains stay coherent.
- Byte-identical no-op does not grow **`undos`**.
- Undo/redo endpoints do **not** trigger webhook write billing.
- Snapshot text that fails **`validateTodosText`** returns **`409`** (no DB mutation).
- Webhook `POST …/undo` and `…/redo` + webhook `PUT` + authenticated `PUT` all maintain stacks consistently.
- `DELETE` list cascades on **`undos`** / **`redos`**.
- Empty **`undos`** / **`redos`**: webhook returns **`409`** + JSON **`message`** (not **`400`**).
- Creating the **51st** list: **`403`** + JSON **`message`**.
- CLI help lists **`todos todo`**, **`todos undo`**, **`todos redo`**; **`config/SKILL.md`** matches.

---

## 14. Summary

- Tables **`undos`** and **`redos`**: `(id, list_id, text, created_at)`, FK → **`lists`**, **≤10 rows each** per list, append-only.
- **Content replace** (§4 — webhook **`PUT`**, authenticated **`PUT`**, etc.; **not** §5–§6): push **`old`** onto **`undos`**, prune, clear **`redos`**, update **`lists`**.
- **`POST /w/:ulid/undo`** / **`redo`** only; register **before** **`/w/:ulid`**. Pop stacks per §5–§6; **`409`** when empty stack or validation fails; **no** webhook write charge.
- **`validateTodosText`** (or equivalent) on undo/redo target body **before** commit.
- Per-task not-done: **`todos todo <n>`**; document history: **`todos undo`** / **`todos redo`**.
- **§15:** at most **50 lists** per user (**`403`** at cap); **500** / **500** `undos` / `redos` rows max per user at full stack depth (**1,000** combined); **10,000** todo lines max at per-list caps.
- **Web UI:** no undo/redo for now.

Implementation wires through **`webhook.ts`** (new routes first in matcher order), **`lists.ts`** (authenticated PUT, **`createList`** cap **`403`**), shared snapshot helpers, and **`src/cli/main.ts`** + **`config/SKILL.md`**.
