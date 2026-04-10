-- Todos DB schema (SQLite)
-- Database: data/todos.db

-- Users: one row per Legendum account. Authenticated via Login and Link with Legendum.
-- legendum_token: stable account-service token for charging credits via Legendum tabs.
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  legendum_token TEXT UNIQUE,
  created_at     INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- Categories: each category is a named todo list with a unique webhook URL.
-- name: display name as typed by user (may contain spaces).
-- slug: URL-safe version (lowercase, spaces/underscores → hyphens). Unique per user.
-- text: the raw todos.txt content (free-form text + todo lines).
-- position: user-defined ordering on the main screen.
CREATE TABLE IF NOT EXISTS categories (
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
CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id);
CREATE INDEX IF NOT EXISTS idx_categories_ulid ON categories(ulid);
CREATE INDEX IF NOT EXISTS idx_categories_user_slug ON categories(user_id, slug);
