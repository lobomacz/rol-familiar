import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from './database.mjs'
import { reassignDay } from './reassignments.mjs'
import { ensureCurrentWeek } from './roles.mjs'

test('superadmins can reassign current-week days, cancel linked swaps and preserve manual choices on refresh', () => {
  const directory = mkdtempSync(join(tmpdir(), 'reassignments-'))
  const previous = process.env.SQLITE_PATH
  process.env.SQLITE_PATH = join(directory, 'test.sqlite')
  let db
  try {
    db = openDatabase()
    for (const [id, role, active] of [[1, 'superadmin', 1], [2, 'usuario', 1], [3, 'admin', 1], [4, 'usuario', 0], [5, 'usuario', 1]])
      db.prepare('INSERT INTO users(id, username, password_hash, nombre, apellido, rol_usuario, activo) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, `user${id}`, 'unused', `Name${id}`, 'Family', role, active)
    for (const [i, date] of ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-10-19', '2026-11-02'].entries())
      db.prepare('INSERT INTO roles(id, date, assigned_user) VALUES (?, ?, ?)').run(i + 1, date, i % 2 ? 3 : 2)
    db.exec("UPDATE users SET ultimo_rol = '2026-11-02' WHERE id = 2; UPDATE users SET ultimo_rol = '2026-10-31' WHERE id = 3;")
    db.exec('UPDATE roles SET replace_user = 3, rol_switched = 1 WHERE id = 1; UPDATE roles SET replace_user = 2, rol_switched = 1 WHERE id = 2;')
    const now = new Date('2026-10-30T18:00:00Z')
    const snapshot = () => db.prepare('SELECT * FROM roles ORDER BY id').all()
    const original = snapshot()
    for (const actor of [2, 3, 4]) assert.throws(() => reassignDay(db, actor, 1, { assigned_user: 5 }, now), { status: 403 })
    for (const id of [8, 9]) assert.throws(() => reassignDay(db, 1, id, { assigned_user: 5 }, now), { status: 403 })
    for (const assigned_user of [1, 4, 999, '3', null]) assert.throws(() => reassignDay(db, 1, 1, { assigned_user }, now), { status: 400 })
    assert.throws(() => reassignDay(db, 1, 999, { assigned_user: 5 }, now), { status: 404 })
    assert.throws(() => reassignDay(db, 1, 1, { assigned_user: 5, expected_replace_user: null }, now), { status: 409 })
    assert.deepEqual(snapshot(), original)
    const week = reassignDay(db, 1, 1, { assigned_user: 5, expected_assigned_user: 2, expected_replace_user: 3 }, now)
    assert.equal(week.roles[0].assigned_user, 5)
    assert.equal(week.roles[0].assigned_name, 'Name5 Family')
    assert.equal(week.roles[0].replace_user, null)
    assert.equal(week.roles[1].replace_user, null)
    assert.equal(week.roles[1].rol_switched, 0)
    assert.deepEqual(snapshot().slice(2), original.slice(2))
    assert.equal(db.prepare('SELECT ultimo_rol FROM users WHERE id = 5').get().ultimo_rol, '2026-10-26')
    // Superadmin overrides may intentionally repeat users on neighboring days.
    reassignDay(db, 1, 5, { assigned_user: 3 }, now)
    const saved = snapshot()
    assert.deepEqual(ensureCurrentWeek(db, now).roles.map(r => r.assigned_user), saved.slice(0, 7).map(r => r.assigned_user))
    assert.deepEqual(snapshot(), saved)
    db.close(); db = openDatabase()
    assert.deepEqual(snapshot(), saved)
  } finally {
    db?.close()
    if (previous === undefined) delete process.env.SQLITE_PATH
    else process.env.SQLITE_PATH = previous
    rmSync(directory, { recursive: true, force: true })
  }
})
