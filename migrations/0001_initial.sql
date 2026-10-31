CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_reset_at TEXT,
  nombre TEXT NOT NULL CHECK(length(trim(nombre)) BETWEEN 1 AND 100),
  apellido TEXT NOT NULL CHECK(length(trim(apellido)) BETWEEN 1 AND 100),
  ultimo_rol TEXT CHECK(ultimo_rol IS NULL OR (date(ultimo_rol, '+0 days') IS NOT NULL AND date(ultimo_rol, '+0 days') = ultimo_rol)),
  activo INTEGER DEFAULT 1 CHECK(activo IS NULL OR activo IN (0, 1)),
  rol_usuario TEXT NOT NULL DEFAULT 'usuario' CHECK(rol_usuario IN ('usuario', 'admin', 'superadmin'))
);
CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS members (id INTEGER PRIMARY KEY, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100));
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE CHECK(date(date, '+0 days') IS NOT NULL AND date(date, '+0 days') = date),
      assigned_user INTEGER NOT NULL REFERENCES users(id),
      replace_user INTEGER REFERENCES users(id),
      rol_switched INTEGER DEFAULT 0 CHECK(rol_switched IS NULL OR rol_switched IN (0, 1))
    );
  
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL CHECK(date(date, '+0 days') IS NOT NULL AND date(date, '+0 days') = date),
      assigned_user INTEGER NOT NULL REFERENCES users(id),
      created_by INTEGER NOT NULL REFERENCES users(id),
      priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('normal', 'atencion', 'critical')),
      parent_id INTEGER REFERENCES notes(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      completed_at TEXT,
      completed_by INTEGER REFERENCES users(id),
      CHECK((completed_at IS NULL) = (completed_by IS NULL))
    );
    CREATE TABLE IF NOT EXISTS note_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id INTEGER NOT NULL REFERENCES notes(id),
      author_id INTEGER NOT NULL REFERENCES users(id),
      text TEXT NOT NULL CHECK(length(trim(text)) BETWEEN 1 AND 4000),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS notes_pending_date ON notes(date) WHERE completed_at IS NULL;
    CREATE INDEX IF NOT EXISTS note_entries_note ON note_entries(note_id, id);
    CREATE TRIGGER IF NOT EXISTS notes_completed_immutable BEFORE UPDATE ON notes
      WHEN OLD.completed_at IS NOT NULL BEGIN SELECT RAISE(ABORT, 'Completed notes are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS notes_no_delete BEFORE DELETE ON notes
      BEGIN SELECT RAISE(ABORT, 'Notes cannot be deleted'); END;
    CREATE TRIGGER IF NOT EXISTS entries_no_update BEFORE UPDATE ON note_entries
      BEGIN SELECT RAISE(ABORT, 'Entries are append only'); END;
    CREATE TRIGGER IF NOT EXISTS entries_no_delete BEFORE DELETE ON note_entries
      BEGIN SELECT RAISE(ABORT, 'Entries are append only'); END;
    CREATE TRIGGER IF NOT EXISTS entries_completed_lock BEFORE INSERT ON note_entries
      WHEN EXISTS (SELECT 1 FROM notes WHERE id = NEW.note_id AND completed_at IS NOT NULL)
      BEGIN SELECT RAISE(ABORT, 'Completed notes are immutable'); END;
    INSERT OR IGNORE INTO schema_migrations(name) VALUES ('notes-and-append-only-entries-v1');
  
CREATE TABLE IF NOT EXISTS app_revision (id INTEGER PRIMARY KEY CHECK(id = 1), version INTEGER NOT NULL);
INSERT OR IGNORE INTO app_revision VALUES (1, 0);
CREATE TABLE IF NOT EXISTS write_guards (id TEXT PRIMARY KEY, valid INTEGER NOT NULL CHECK(valid = 1));
CREATE TABLE IF NOT EXISTS auth_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS users_nombre_apellido_username_unique ON users(nombre COLLATE NOCASE, apellido COLLATE NOCASE, username COLLATE NOCASE);
