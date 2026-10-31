import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { replacementOptions, switchAssignment } from './role-swaps.mjs'
import { listWeekStarting } from './roles.mjs'

const now = new Date('2026-10-30T12:00:00Z')
function fixture() {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, nombre TEXT, apellido TEXT, activo INTEGER, rol_usuario TEXT);
    CREATE TABLE roles (id INTEGER PRIMARY KEY, date TEXT UNIQUE, assigned_user INTEGER NOT NULL, replace_user INTEGER, rol_switched INTEGER DEFAULT 0);
    INSERT INTO users VALUES (1, 'A', 'One', 1, 'usuario'), (2, 'B', 'Two', 1, 'admin'), (3, 'C', 'Three', 1, 'usuario'),
      (4, 'Inactive', 'Four', 0, 'usuario'), (5, 'Super', 'Admin', 1, 'superadmin'), (6, 'New', 'Six', 1, 'admin'), (7, 'Null', 'Seven', NULL, 'usuario');
    INSERT INTO roles (id, date, assigned_user) VALUES (1, '2026-10-26', 1), (2, '2026-10-27', 2), (3, '2026-10-28', 3),
      (4, '2026-10-29', 2), (5, '2026-10-30', 1), (6, '2026-10-31', 3), (7, '2026-11-01', 1), (8, '2026-10-19', 1);`)
  return db
}
const snapshot = db => db.prepare('SELECT * FROM roles ORDER BY id').all()
const enable = (replace_user, replace_role_id = replace_user === 2 ? 2 : replace_user === 3 ? 3 : undefined) => ({ rol_switched: true, replace_user, replace_role_id })
const rejectStatus = status => error => error.status === status

test('replacement options include active regular/admin users only and expose no credentials', () => {
  const db = fixture()
  try {
    assert.deepEqual(replacementOptions(db, 1, 1, now).users.map(user => user.id), [2, 3, 6])
    assert.deepEqual(Object.keys(replacementOptions(db, 1, 1, now).users[0]), ['id', 'nombre', 'apellido', 'days'])
    assert.deepEqual(replacementOptions(db, 1, 1, now).users[0].days.map(day => day.id), [2, 4])
    assert.throws(() => replacementOptions(db, 1, 2, now), rejectStatus(403))
    assert.throws(() => replacementOptions(db, 8, 1, now), rejectStatus(403))
  } finally { db.close() }
})
test('confirmed swaps update only the source and selected reciprocal day and undo from either owner', () => {
  for (const [roleId, userId] of [[1, 1], [2, 2]]) {
    const db = fixture()
    try {
      const original = snapshot(db)
      const week = switchAssignment(db, 1, 1, enable(2), now)
      assert.equal(week.roles.length, 7)
      assert.equal(week.roles.find(role => role.id === 1).replace_user, 2)
      assert.equal(week.roles.find(role => role.id === 1).replacement_name, 'B Two')
      assert.equal(week.roles.find(role => role.id === 2).replace_user, 1)
      assert.equal(week.roles.find(role => role.id === 2).rol_switched, 1)
      assert.equal(week.roles.find(role => role.id === 4).replace_user, null)
      assert.equal(week.roles.find(role => role.id === 4).rol_switched, 0)
      assert.deepEqual(replacementOptions(db, 3, 3, now).users.map(user => user.id), [6])
      assert.deepEqual(replacementOptions(db, 5, 1, now).users, [])
      const restored = switchAssignment(db, roleId, userId, { rol_switched: false }, now)
      assert.deepEqual(snapshot(db), original)
      assert.deepEqual(switchAssignment(db, roleId, userId, { rol_switched: false }, now), restored)
    } finally { db.close() }
  }
})
test('undo leaves unrelated swaps and past weeks unchanged', () => {
  const db = fixture()
  try {
    switchAssignment(db, 1, 1, enable(2), now)
    switchAssignment(db, 3, 3, enable(6), now)
    switchAssignment(db, 2, 2, { rol_switched: false }, now)
    const roles = snapshot(db)
    assert.equal(roles.find(role => role.id === 3).replace_user, 6)
    assert.ok(roles.filter(role => [1, 2, 4].includes(role.id)).every(role => role.replace_user === null && role.rol_switched === 0))
    assert.equal(roles.find(role => role.id === 8).replace_user, null)
  } finally { db.close() }
})
test('invalid, unauthorized, inactive and stale swap requests cannot partially change assignments', () => {
  const db = fixture()
  try {
    const original = snapshot(db)
    for (const data of [enable(1), enable(4), enable(5), enable(7), enable(999)]) {
      assert.throws(() => switchAssignment(db, 1, 1, data, now), rejectStatus(409))
      assert.deepEqual(snapshot(db), original)
    }
    assert.throws(() => switchAssignment(db, 1, 2, enable(3), now), rejectStatus(403))
    assert.throws(() => switchAssignment(db, 8, 1, enable(2), now), rejectStatus(403))
    assert.throws(() => switchAssignment(db, 999, 1, enable(2), now), rejectStatus(404))
    assert.throws(() => switchAssignment(db, 1, 1, { rol_switched: 'true' }, now), rejectStatus(400))
    assert.throws(() => switchAssignment(db, 1, 1, enable('2'), now), rejectStatus(400))
    replacementOptions(db, 1, 1, now)
    db.exec('UPDATE users SET activo = 0 WHERE id = 2')
    assert.throws(() => switchAssignment(db, 1, 1, enable(2), now), rejectStatus(409))
    assert.deepEqual(snapshot(db), original)
    db.exec('UPDATE users SET activo = 1 WHERE id = 2')
    switchAssignment(db, 1, 1, enable(2), now)
    const paired = snapshot(db)
    assert.throws(() => switchAssignment(db, 3, 3, enable(2), now), rejectStatus(409))
    assert.throws(() => switchAssignment(db, 5, 1, enable(6), now), rejectStatus(409))
    assert.deepEqual(snapshot(db), paired)
    assert.throws(() => switchAssignment(db, 1, 2, { rol_switched: false }, now), rejectStatus(403))
    assert.deepEqual(snapshot(db), paired)
  } finally { db.close() }
})
test('reading a selected historical week does not create or change assignments', () => {
  const db = fixture()
  try {
    const original = snapshot(db)
    assert.equal(listWeekStarting(db, '2026-10-19').roles.length, 1)
    assert.deepEqual(listWeekStarting(db, '2026-10-12').roles, [])
    assert.deepEqual(snapshot(db), original)
  } finally { db.close() }
})

test('multiple-day replacements require a valid selected day and reject stale selections atomically', () => {
  const db = fixture()
  try {
    const original = snapshot(db)
    for (const [replace_role_id, status] of [[undefined, 400], [null, 400], [3, 409], [8, 409], ['4', 409], [999, 409]]) {
      assert.throws(() => switchAssignment(db, 1, 1, { rol_switched: true, replace_user: 2, replace_role_id }, now), rejectStatus(status))
      assert.deepEqual(snapshot(db), original)
    }
    switchAssignment(db, 1, 1, enable(2, 4), now)
    assert.equal(db.prepare('SELECT replace_user FROM roles WHERE id = 4').get().replace_user, 1)
    assert.equal(db.prepare('SELECT replace_user FROM roles WHERE id = 2').get().replace_user, null)
    assert.deepEqual(replacementOptions(db, 2, 2, now).users, [])
    assert.deepEqual(replacementOptions(db, 3, 3, now).users.map(user => user.id), [6])
    const paired = snapshot(db)
    assert.throws(() => switchAssignment(db, 3, 3, enable(2, 2), now), rejectStatus(409))
    assert.deepEqual(snapshot(db), paired)
    switchAssignment(db, 4, 2, { rol_switched: false }, now)
    assert.deepEqual(snapshot(db), original)
  } finally { db.close() }
})
test('single assigned day is selected automatically and users without days remain reserved after saving', () => {
  const db = fixture()
  try {
    db.exec('UPDATE roles SET assigned_user = 3 WHERE id = 4')
    switchAssignment(db, 1, 1, { rol_switched: true, replace_user: 2 }, now)
    assert.equal(db.prepare('SELECT replace_user FROM roles WHERE id = 2').get().replace_user, 1)
    switchAssignment(db, 1, 1, { rol_switched: false }, now)
    switchAssignment(db, 1, 1, enable(6), now)
    assert.deepEqual(replacementOptions(db, 5, 1, now).users, [])
    assert.ok(!replacementOptions(db, 3, 3, now).users.some(user => [1, 6].includes(user.id)))
  } finally { db.close() }
})

test('superadmins can disable either side of any current-week swap without affecting unrelated swaps', () => {
  for (const roleId of [1, 2]) {
    const db = fixture()
    try {
      switchAssignment(db, 1, 1, enable(2), now)
      switchAssignment(db, 3, 3, enable(6), now)
      db.exec("UPDATE roles SET replace_user = 2, rol_switched = 1 WHERE id = 8; INSERT INTO roles VALUES (9, '2026-11-02', 1, 2, 1)")
      const before = snapshot(db)
      assert.throws(() => switchAssignment(db, roleId, 5, { rol_switched: false, expected_replace_user: 999 }, now), rejectStatus(409))
      assert.throws(() => switchAssignment(db, roleId, 6, { rol_switched: false }, now), rejectStatus(403))
      for (const id of [8, 9]) assert.throws(() => switchAssignment(db, id, 5, { rol_switched: false }, now), rejectStatus(403))
      assert.deepEqual(replacementOptions(db, 4, 5, now).users, [])
      assert.throws(() => switchAssignment(db, 4, 5, enable(3), now), rejectStatus(409))
      assert.deepEqual(snapshot(db), before)
      const expected = before.find(role => role.id === roleId).replace_user
      const week = switchAssignment(db, roleId, 5, { rol_switched: false, expected_replace_user: expected }, now)
      for (const id of [1, 2]) {
        assert.equal(week.roles.find(role => role.id === id).replace_user, null)
        assert.equal(week.roles.find(role => role.id === id).rol_switched, 0)
      }
      assert.deepEqual(snapshot(db).filter(role => ![1, 2].includes(role.id)), before.filter(role => ![1, 2].includes(role.id)))
    } finally { db.close() }
  }
})
test('superadmins can disable a replacement without a reciprocal day', () => {
  const db = fixture()
  try {
    const original = snapshot(db)
    switchAssignment(db, 1, 1, enable(6), now)
    switchAssignment(db, 1, 5, { rol_switched: false, expected_replace_user: 6 }, now)
    assert.deepEqual(snapshot(db), original)
  } finally { db.close() }
})

test('superadmins start and undo replacements on every current-week day using the original participant', () => {
  for (let roleId = 1; roleId <= 7; roleId++) {
    const db = fixture()
    try {
      const before = snapshot(db)
      const source = before.find(role => role.id === roleId)
      const replacement = replacementOptions(db, roleId, 5, now).users.find(user => user.days.length)
      const week = switchAssignment(db, roleId, 5, { rol_switched: true, replace_user: replacement.id, replace_role_id: replacement.days[0].id }, now)
      assert.equal(week.roles.find(role => role.id === roleId).replace_user, replacement.id)
      assert.equal(week.roles.find(role => role.id === replacement.days[0].id).replace_user, source.assigned_user)
      switchAssignment(db, roleId, 5, { rol_switched: false, expected_replace_user: replacement.id }, now)
      assert.deepEqual(snapshot(db), before)
      assert.throws(() => replacementOptions(db, 8, 5, now), rejectStatus(403))
    } finally { db.close() }
  }
})
