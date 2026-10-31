import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { openDatabase } from '../server/database.mjs'
import { hashPassword } from '../server/auth.mjs'
import { fixture, sqlStatements } from './test-helpers.mjs'
const execute = promisify(execFile)

test('bootstrap SQL creates a protected superadmin and refuses to replace an existing installation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rol-cf-bootstrap-'))
  const { runtime, db } = await fixture()
  try {
    const file = join(directory, 'admin.private.sql')
    await execute(process.execPath, ['scripts/cloudflare-admin.mjs', '--file', file])
    assert.equal((await stat(file)).mode & 0o777, 0o600)
    const sql = await readFile(file, 'utf8')
    const apply = () => db.batch(sqlStatements(sql).map(statement => db.prepare(statement)))
    await apply()
    const account = await db.prepare('SELECT * FROM users').first()
    assert.equal(account.nombre, 'Superadmin')
    assert.equal(account.rol_usuario, 'superadmin')
    assert.ok(account.password_reset_at)
    assert.match(account.password_hash, /^scrypt\$/)
    await assert.rejects(apply)
    assert.equal((await db.prepare('SELECT count(*) AS count FROM users').first()).count, 1)
    assert.equal((await db.prepare('SELECT password_hash FROM users').first()).password_hash, account.password_hash)
  } finally { await runtime.dispose(); await rm(directory, { recursive: true, force: true }) }
})
test('SQLite export imports completed notes, appended text and credentials into D1 without importing sessions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rol-cf-export-'))
  const { runtime, db } = await fixture()
  const oldPath = process.env.SQLITE_PATH
  const path = join(directory, 'source.sqlite')
  const file = join(directory, 'export.private.sql')
  let source
  try {
    process.env.SQLITE_PATH = path
    source = openDatabase()
    const hash = await hashPassword('Export-only-password-42!')
    source.prepare('INSERT INTO users(id, username, password_hash, nombre, apellido, rol_usuario) VALUES(1, ?, ?, ?, ?, ?)').run('admin', hash, 'Superadmin', "O'Neil", 'superadmin')
    source.exec(`INSERT INTO roles(id, date, assigned_user) VALUES(1, '2026-10-30', 1);
      INSERT INTO sessions VALUES('old-session', 1, 9999999999999);
      INSERT INTO notes(id, date, assigned_user, created_by, priority) VALUES(1, '2026-10-30', 1, 1, 'critical');`)
    source.prepare('INSERT INTO note_entries(note_id, author_id, text) VALUES(1, 1, ?)').run("Texto con 'comillas' y ñ")
    source.exec("UPDATE notes SET completed_at = '2026-10-30T12:00:00Z', completed_by = 1 WHERE id = 1")
    source.close(); source = null
    await execute(process.execPath, ['scripts/export-d1.mjs', '--file', file], { env: { ...process.env, SQLITE_PATH: path } })
    assert.equal((await stat(file)).mode & 0o777, 0o600)
    await db.batch(sqlStatements(await readFile(file, 'utf8')).map(statement => db.prepare(statement)))
    const account = await db.prepare('SELECT * FROM users').first()
    assert.equal(account.apellido, "O'Neil")
    assert.equal(account.password_hash, hash)
    assert.equal((await db.prepare('SELECT * FROM notes').first()).completed_by, 1)
    assert.equal((await db.prepare('SELECT * FROM note_entries').first()).text, "Texto con 'comillas' y ñ")
    assert.equal((await db.prepare('SELECT count(*) AS count FROM sessions').first()).count, 0)
    assert.equal((await db.prepare('PRAGMA foreign_key_check').all()).results.length, 0)
  } finally {
    source?.close()
    if (oldPath === undefined) delete process.env.SQLITE_PATH; else process.env.SQLITE_PATH = oldPath
    await runtime.dispose(); await rm(directory, { recursive: true, force: true })
  }
})
