CREATE TABLE IF NOT EXISTS week_locks (
  week_start TEXT PRIMARY KEY,
  lock_type TEXT NOT NULL CHECK(lock_type IN ('manual', 'automatic')),
  locked_by INTEGER REFERENCES users(id),
  author TEXT NOT NULL,
  locked_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS deleted_notes (
  note_id INTEGER PRIMARY KEY REFERENCES notes(id),
  deleted_by INTEGER NOT NULL REFERENCES users(id),
  deleted_at TEXT NOT NULL
);
