import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { ensureCurrentWeek, weekRange, listWeek } from './roles.mjs'

const now = new Date('2026-10-26T12:00:00Z')
function database() {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE IF NOT EXISTS week_locks (
  week_start TEXT PRIMARY KEY,
  lock_type TEXT NOT NULL CHECK(lock_type IN ('manual', 'automatic')),
  locked_by INTEGER REFERENCES users(id),
  author TEXT NOT NULL,
  locked_at TEXT NOT NULL
);
`)
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, nombre TEXT, apellido TEXT, ultimo_rol TEXT, activo INTEGER, rol_usuario TEXT);
    CREATE TABLE roles (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT UNIQUE, assigned_user INTEGER NOT NULL, replace_user INTEGER, rol_switched INTEGER DEFAULT 0, manually_assigned INTEGER NOT NULL DEFAULT 0);`)
  return db
}
function assertAssignments(week, eligible, previousUser) {
  assert.equal(week.roles.length, 7)
  for (let index = 0; index < 7; index++) {
    const role = week.roles[index]
    assert.ok(eligible.includes(role.assigned_user))
    assert.notEqual(role.assigned_user, index ? week.roles[index - 1].assigned_user : previousUser)
    assert.equal(role.date, new Date(Date.parse(`${week.start}T12:00:00Z`) + index * 86400000).toISOString().slice(0, 10))
  }
}
test('calendar weeks use Managua time, Monday through Sunday, across year boundaries', () => {
  assert.deepEqual(weekRange(0, new Date('2027-01-04T05:59:59Z')), { start: '2026-12-28', end: '2027-01-03' })
  assert.deepEqual(weekRange(0, new Date('2027-01-04T06:00:00Z')), { start: '2027-01-04', end: '2027-01-10' })
})
test('zero or one active non-superadmin users creates no entries and explains why', () => {
  const db = database()
  try {
    assert.equal(ensureCurrentWeek(db, now).generationBlocked, 'INSUFFICIENT_ACTIVE_USERS')
    db.exec(`INSERT INTO users VALUES (1, 'A', 'A', NULL, 1, 'usuario'), (2, 'B', 'B', NULL, 1, 'superadmin'), (3, 'C', 'C', NULL, 0, 'admin'), (4, 'D', 'D', NULL, NULL, 'usuario')`)
    const week = ensureCurrentWeek(db, now)
    assert.equal(week.roles.length, 0)
    assert.equal(week.generationBlocked, 'INSUFFICIENT_ACTIVE_USERS')
    assert.equal(db.prepare('SELECT ultimo_rol FROM users WHERE id = 1').get().ultimo_rol, null)
    db.exec('UPDATE users SET activo = 1 WHERE id = 3')
    assertAssignments(ensureCurrentWeek(db, now), [1, 3])
  } finally { db.close() }
})
test('random assignments cover every day, never repeat adjacent users and preserve recorded weeks', () => {
  const db = database()
  try {
    db.exec(`INSERT INTO users VALUES (1, 'A', 'A', NULL, 1, 'usuario'), (2, 'B', 'B', NULL, 1, 'admin'), (3, 'C', 'C', NULL, 1, 'superadmin'), (4, 'D', 'D', NULL, 0, 'usuario'), (5, 'E', 'E', NULL, 1, 'usuario')`)
    let previousUser
    let previousWeek
    for (let offset = 0; offset < 20; offset++) {
      const date = new Date(now.getTime() + offset * 7 * 86400000)
      const week = ensureCurrentWeek(db, date)
      assertAssignments(week, [1, 2, 5], previousUser)
      const counts = [1, 2, 5].map(id => week.roles.filter(role => role.assigned_user === id).length)
      assert.ok(counts.every(count => count > 0))
      assert.ok(Math.max(...counts) - Math.min(...counts) <= 1)
      assert.equal(week.generationBlocked, null)
      assert.deepEqual(ensureCurrentWeek(db, date), week)
      if (previousWeek) assert.deepEqual(listWeek(db, -1, date).roles, previousWeek.roles)
      previousUser = week.roles[6].assigned_user
      previousWeek = week
    }
    for (const id of [1, 2, 5]) {
      const last = db.prepare('SELECT max(date) AS date FROM roles WHERE assigned_user = ?').get(id).date
      assert.equal(db.prepare('SELECT ultimo_rol FROM users WHERE id = ?').get(id).ultimo_rol, last)
    }
  } finally { db.close() }
})

test('generation only creates the current week and never backfills missed past weeks', () => {
  const db = database()
  try {
    db.exec(`INSERT INTO users VALUES (1, 'A', 'A', NULL, 1, 'usuario'), (2, 'B', 'B', NULL, 1, 'admin')`)
    const original = ensureCurrentWeek(db, now)
    const later = new Date(now.getTime() + 4 * 7 * 86400000)
    const current = ensureCurrentWeek(db, later)
    assertAssignments(current, [1, 2])
    assert.equal(db.prepare('SELECT count(*) AS count FROM roles').get().count, 14)
    for (const offset of [-1, -2, -3]) {
      assert.deepEqual(listWeek(db, offset, later).roles, [])
    }
    assert.deepEqual(listWeek(db, -4, later).roles, original.roles)
    assert.equal(db.prepare('SELECT count(*) AS count FROM roles').get().count, 14)
    assert.deepEqual(ensureCurrentWeek(db, later), current)
  } finally { db.close() }
})

test('invalid current assignments are removed when fewer than two eligible users remain', () => {
  const db = database()
  try {
    db.exec(`INSERT INTO users VALUES (1, 'Super', 'Admin', '2026-11-01', 1, 'superadmin'), (2, 'A', 'A', NULL, 1, 'usuario');
      INSERT INTO roles (date, assigned_user) VALUES ('2026-10-19', 1);`)
    for (let day = 26; day <= 31; day++) db.prepare('INSERT INTO roles (date, assigned_user) VALUES (?, 1)').run(`2026-10-${day}`)
    db.exec("INSERT INTO roles (date, assigned_user) VALUES ('2026-11-01', 1)")
    const result = ensureCurrentWeek(db, now)
    assert.deepEqual(result.roles, [])
    assert.equal(result.generationBlocked, 'INSUFFICIENT_ACTIVE_USERS')
    assert.equal(db.prepare('SELECT count(*) AS count FROM roles').get().count, 1)
    assert.equal(db.prepare('SELECT ultimo_rol FROM users WHERE id = 1').get().ultimo_rol, '2026-10-19')
    assert.deepEqual(ensureCurrentWeek(db, now), result)
  } finally { db.close() }
})
test('legacy superadmin assignments are replaced using two eligible users only', () => {
  const db = database()
  try {
    db.exec(`INSERT INTO users VALUES (1, 'Super', 'Admin', '2026-11-01', 1, 'superadmin'), (2, 'A', 'A', NULL, 1, 'usuario'), (3, 'B', 'B', NULL, 1, 'admin');
      INSERT INTO roles (date, assigned_user) VALUES ('2026-10-26', 1), ('2026-10-27', 1);`)
    const result = ensureCurrentWeek(db, now)
    assertAssignments(result, [2, 3])
    assert.equal(db.prepare('SELECT ultimo_rol FROM users WHERE id = 1').get().ultimo_rol, null)
    assert.deepEqual(ensureCurrentWeek(db, now), result)
    db.exec('UPDATE users SET activo = 0 WHERE id = 3')
    assert.deepEqual(ensureCurrentWeek(db, now).roles, [])
  } finally { db.close() }
})

test('a newly added active admin participates alongside regular users in the current week', () => {
  const db = database()
  try {
    db.exec(`INSERT INTO users VALUES (1, 'A', 'A', NULL, 1, 'usuario'), (2, 'B', 'B', NULL, 1, 'usuario'), (3, 'Super', 'Admin', NULL, 1, 'superadmin')`)
    assertAssignments(ensureCurrentWeek(db, now), [1, 2])
    db.exec("INSERT INTO users VALUES (4, 'C', 'C', NULL, 1, 'admin')")
    const week = ensureCurrentWeek(db, now)
    assertAssignments(week, [1, 2, 4])
    for (const id of [1, 2, 4]) assert.ok(week.roles.some(role => role.assigned_user === id))
    assert.deepEqual(ensureCurrentWeek(db, now), week)
    assert.equal(db.prepare('SELECT count(*) AS count FROM roles').get().count, 7)
    assert.deepEqual(listWeek(db, -1, now).roles, [])
  } finally { db.close() }
})
