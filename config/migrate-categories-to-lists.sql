-- One-shot migration: rename `categories` → `lists`.
-- Gated in src/lib/db.ts by the presence of the `categories` table; after
-- this runs, that precondition flips to false and subsequent boots skip it.

ALTER TABLE categories RENAME TO lists;

DROP INDEX IF EXISTS idx_categories_user;
DROP INDEX IF EXISTS idx_categories_ulid;
DROP INDEX IF EXISTS idx_categories_user_slug;

CREATE INDEX IF NOT EXISTS idx_lists_user       ON lists(user_id);
CREATE INDEX IF NOT EXISTS idx_lists_ulid       ON lists(ulid);
CREATE INDEX IF NOT EXISTS idx_lists_user_slug  ON lists(user_id, slug);
