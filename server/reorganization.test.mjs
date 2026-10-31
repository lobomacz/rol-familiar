import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from './database.mjs'
import { ensureCurrentWeek, listWeek } from './roles.mjs'
import { reorganizeWeek, reorganizedUsers } from './reorganization.mjs'
import { reassignDay } from './reassignments.mjs'
const now = new Date('2026-10-26T12:00:00Z')
test('reorganization is superadmin-only, changes the week, preserves days and history, and clears manual choices and swaps', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reorganize-'))
  const previousPath = process.env.SQLITE_PATH
  process.env.SQLITE_PATH = join(dir, 'test.sqlite')
  const db = openDatabase()
  try {
    for (let id = 1; id <= 4; id++) db.prepare('INSERT INTO users(id, username, password_hash, nombre, apellido, rol_usuario) VALUES (?, ?, ?, ?, ?, ?)').run(id, `u${id}`, 'hash', `User${id}`, 'Test', id === 1 ? 'superadmin' : 'usuario')
    db.exec("INSERT INTO roles(date, assigned_user) VALUES ('2026-10-25', 2), ('2026-11-02', 3)")
    ensureCurrentWeek(db, now)
    const source = listWeek(db, 0, now).roles[0]
    reassignDay(db, 1, source.id, { assigned_user: source.assigned_user === 2 ? 3 : 2 }, now)
    db.prepare('UPDATE roles SET replace_user = ?, rol_switched = 1 WHERE id = ?').run(4, source.id)
    const before = listWeek(db, 0, now)
    const outside = db.prepare('SELECT * FROM roles WHERE date < ? OR date > ?').all(before.start, before.end)
    assert.throws(() => reorganizeWeek(db, 2, now), { status: 403 })
    const after = reorganizeWeek(db, 1, now)
    assert.notDeepEqual(after.roles.map(role => role.assigned_user), before.roles.map(role => role.assigned_user))
    assert.deepEqual(after.roles.map(role => role.id), before.roles.map(role => role.id))
    for (let i = 0; i < 7; i++) {
      assert.ok([2, 3, 4].includes(after.roles[i].assigned_user))
      assert.notEqual(after.roles[i].assigned_user, i ? after.roles[i - 1].assigned_user : 2)
      assert.equal(after.roles[i].replace_user, null)
      assert.equal(after.roles[i].manually_assigned, 0)
    }
    assert.deepEqual(db.prepare('SELECT * FROM roles WHERE date < ? OR date > ?').all(before.start, before.end), outside)
    assert.deepEqual(ensureCurrentWeek(db, now).roles, after.roles)
  } finally {
    db.close()
    if (previousPath === undefined) delete process.env.SQLITE_PATH; else process.env.SQLITE_PATH = previousPath
    rmSync(dir, { recursive: true, force: true })
  }
})
test('reorganization reports when a different distribution is impossible', () => {
  assert.throws(() => reorganizedUsers([{ id: 2 }], undefined, []), { status: 409 })
  const existing = [3, 2, 3, 2, 3, 2, 3].map(assigned_user => ({ assigned_user }))
  assert.throws(() => reorganizedUsers([{ id: 2 }, { id: 3 }], 2, existing), { status: 409 })
})
