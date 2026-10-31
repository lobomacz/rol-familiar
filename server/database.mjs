import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const usersSchema = name => `CREATE TABLE ${name} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_reset_at TEXT,
  nombre TEXT NOT NULL CHECK(length(trim(nombre)) BETWEEN 1 AND 100),
  apellido TEXT NOT NULL CHECK(length(trim(apellido)) BETWEEN 1 AND 100),
  ultimo_rol TEXT CHECK(ultimo_rol IS NULL OR (date(ultimo_rol, '+0 days') IS NOT NULL AND date(ultimo_rol, '+0 days') = ultimo_rol)),
  activo INTEGER DEFAULT 1 CHECK(activo IS NULL OR activo IN (0, 1)),
  rol_usuario TEXT NOT NULL DEFAULT 'usuario' CHECK(rol_usuario IN ('usuario', 'admin', 'superadmin'))
)`

export function openDatabase() {
  const path = resolve(process.env.SQLITE_PATH || './data/rol-familiar.sqlite')
  mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
  const columns = db.prepare('PRAGMA table_info(users)').all()
  if (!columns.length) db.exec(usersSchema('users'))
  else if (!columns.some(column => column.name === 'nombre')) {
    // Preserve existing IDs, credentials and sessions while replacing the legacy table.
    db.exec('PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;')
    try {
      db.exec(usersSchema('users_migrated'))
      db.exec(`INSERT INTO users_migrated (id, username, password_hash, nombre, apellido, rol_usuario)
        SELECT id, username, password_hash,
          CASE WHEN id = 1 AND lower(username) = 'admin' THEN 'Superadmin' ELSE username END, 'Sin especificar',
          CASE WHEN id = 1 AND lower(username) = 'admin' THEN 'superadmin' ELSE 'usuario' END FROM users;
        DROP TABLE users;
        ALTER TABLE users_migrated RENAME TO users;
        COMMIT;`)
    } catch (error) { db.exec('ROLLBACK'); db.close(); throw error }
  }
  if (!db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'password_reset_at'))
    db.exec('ALTER TABLE users ADD COLUMN password_reset_at TEXT')
  db.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS members (id INTEGER PRIMARY KEY, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100));
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE CHECK(date(date, '+0 days') IS NOT NULL AND date(date, '+0 days') = date),
      assigned_user INTEGER NOT NULL REFERENCES users(id),
      replace_user INTEGER REFERENCES users(id),
      rol_switched INTEGER DEFAULT 0 CHECK(rol_switched IS NULL OR rol_switched IN (0, 1))
    );
  `)
  if (!db.prepare('PRAGMA table_info(roles)').all().some(column => column.name === 'manually_assigned'))
    db.exec('ALTER TABLE roles ADD COLUMN manually_assigned INTEGER NOT NULL DEFAULT 0 CHECK(manually_assigned IN (0, 1))')
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)')
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS users_nombre_apellido_username_unique
      ON users (nombre COLLATE NOCASE, apellido COLLATE NOCASE, username COLLATE NOCASE)`)
    const migration = 'initial-admin-superadmin-profile'
    if (!db.prepare('SELECT 1 FROM schema_migrations WHERE name = ?').get(migration)
      && db.prepare("SELECT 1 FROM users WHERE id = 1 AND username = 'admin' COLLATE NOCASE").get()) {
      db.prepare("UPDATE users SET nombre = 'Superadmin', rol_usuario = 'superadmin' WHERE id = 1 AND username = 'admin' COLLATE NOCASE").run()
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(migration)
    }
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); db.close(); throw error }
  db.exec(`
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
  `)
  db.exec(`CREATE TABLE IF NOT EXISTS week_locks (
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
`)
  return db
}
