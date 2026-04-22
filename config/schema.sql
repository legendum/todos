-- Todos DB schema (SQLite)
-- Database: data/todos.db

-- Users: one row per Legendum account. Authenticated via Login and Link with Legendum.
-- email: stable identity from Legendum (NULL for self-hosted mode).
-- legendum_token: account-service token for charging credits via Legendum tabs.
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT NOT NULL UNIQUE,
  legendum_token TEXT,
  created_at     INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- Lists: each list is a named todo list with a unique webhook URL.
-- name: display name as typed by user (may contain spaces).
-- slug: URL-safe version (lowercase, spaces/underscores → hyphens). Unique per user.
-- text: the raw todos.md content (free-form text + todo lines).
-- position: user-defined ordering on the main screen.
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_lists_user ON lists(user_id);
CREATE INDEX IF NOT EXISTS idx_lists_ulid ON lists(ulid);
CREATE INDEX IF NOT EXISTS idx_lists_user_slug ON lists(user_id, slug);
