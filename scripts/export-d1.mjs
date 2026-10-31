import { DatabaseSync } from 'node:sqlite'
import { writeFile } from 'node:fs/promises'
const index = process.argv.indexOf('--file')
const file = index >= 0 ? process.argv[index + 1] : null
if (!file || !process.env.SQLITE_PATH) throw new Error('Uso: SQLITE_PATH=/ruta/base.sqlite npm run cf:export -- --file /ruta/privada/export.sql')
const db = new DatabaseSync(process.env.SQLITE_PATH, { readOnly: true })
const literal = value => value === null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`
const rows = [], completions = []
db.exec('BEGIN')
try {
  for (const table of ['users', 'members', 'roles', 'notes', 'note_entries']) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) continue
    for (const source of db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()) {
      const row = { ...source }
      if (table === 'notes' && row.completed_at) {
        completions.push(`UPDATE notes SET completed_at = ${literal(row.completed_at)}, completed_by = ${literal(row.completed_by)} WHERE id = ${row.id};`)
        row.completed_at = null; row.completed_by = null
      }
      const fields = Object.keys(row)
      rows.push(`INSERT INTO ${table} (${fields.join(', ')}) VALUES (${fields.map(field => literal(row[field])).join(', ')});`)
    }
  }
  db.exec('COMMIT')
} finally { db.close() }
// Run against an EMPTY migrated D1 database; duplicate IDs fail safely.
// Sessions are intentionally omitted so every user signs in again after migration.
await writeFile(file, ['PRAGMA defer_foreign_keys = ON;', ...rows, ...completions,
  'UPDATE app_revision SET version = version + 1 WHERE id = 1;', ''].join('\n'), { mode: 0o600, flag: 'wx' })
console.log(`Exportación guardada en: ${file}. Contiene hashes y datos privados; no la agregue a Git.`)
