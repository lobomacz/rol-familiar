import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { changeUserRole } from './user-roles.mjs'
import { canChangeUserRole } from '../src/helpers/user-role-policy.js'

test('only superadmins can change an existing admin role, including self changes', () => {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, username TEXT, rol_usuario TEXT, activo INTEGER);
    INSERT INTO users VALUES (1, 'root', 'superadmin', 1), (2, 'manager', 'admin', 1),
    (3, 'other-manager', 'admin', 1), (4, 'member', 'usuario', 1),
    (5, 'disabled', 'admin', 0), (6, 'admin', 'admin', 1);`)
  const get = id => db.prepare('SELECT * FROM users WHERE id = ?').get(id)
  try {
    for (const target of [2, 3]) {
      assert.equal(canChangeUserRole(get(2), get(target)), false)
      assert.throws(() => changeUserRole(db, 2, target, { rol_usuario: 'usuario' }), { status: 403 })
      assert.equal(get(target).rol_usuario, 'admin')
    }
    for (const [actor, target] of [[4, 3], [5, 4], [2, 1], [1, 1], [1, 6]])
      assert.throws(() => changeUserRole(db, actor, target, { rol_usuario: 'usuario' }), { status: 403 })
    assert.equal(canChangeUserRole(get(1), get(3)), true)
    assert.deepEqual(changeUserRole(db, 1, 3, { rol_usuario: 'usuario' }), { id: 3, rol_usuario: 'usuario' })
    assert.equal(get(3).rol_usuario, 'usuario')
    changeUserRole(db, 2, 3, { rol_usuario: 'admin' })
    assert.equal(get(3).rol_usuario, 'admin')
    // A formerly regular target is checked again on every write, preventing stale UI bypasses.
    assert.throws(() => changeUserRole(db, 2, 3, { rol_usuario: 'usuario' }), { status: 403 })
    assert.throws(() => changeUserRole(db, 1, 4, { rol_usuario: 'superadmin' }), { status: 400 })
    assert.throws(() => changeUserRole(db, 1, 4, {}), { status: 400 })
    assert.throws(() => changeUserRole(db, 1, 999, { rol_usuario: 'usuario' }), { status: 404 })
  } finally { db.close() }
})
