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
function participants(db, count = 7) {
  for (let id = 1; id <= count; id++) db.prepare('INSERT INTO users VALUES (?, ?, ?, NULL, 1, ?)').run(id, `User${id}`, 'Family', id === 1 ? 'admin' : 'usuario')
}
function assertAssignments(week, eligible) {
  assert.equal(week.roles.length, 7)
  assert.equal(new Set(week.roles.map(role => role.assigned_user)).size, 7)
  for (const [index, role] of week.roles.entries()) {
    assert.ok(eligible.includes(role.assigned_user))
    assert.equal(role.date, new Date(Date.parse(`${week.start}T12:00:00Z`) + index * 86400000).toISOString().slice(0, 10))
  }
}
test('calendar weeks use Managua time across year boundaries', () => {
  assert.deepEqual(weekRange(0, new Date('2027-01-04T05:59:59Z')), { start: '2026-12-28', end: '2027-01-03' })
  assert.deepEqual(weekRange(0, new Date('2027-01-04T06:00:00Z')), { start: '2027-01-04', end: '2027-01-10' })
})
test('fewer than three eligible users blocks generation without partial writes', () => {
  for (let count = 0; count < 3; count++) {
    const db = database()
    try {
      participants(db, count)
      const week = ensureCurrentWeek(db, now)
      assert.equal(week.generationBlocked, 'INSUFFICIENT_ACTIVE_USERS')
      assert.deepEqual(week.roles, [])
      assert.equal(db.prepare('SELECT count(*) AS n FROM users WHERE ultimo_rol IS NOT NULL').get().n, 0)
    } finally { db.close() }
  }
})
test('automatic weeks use unique eligible participants, respect history, and remain stable on refresh', () => {
  const db = database()
  try {
    participants(db)
    db.exec("INSERT INTO users VALUES (8, 'Super', 'Admin', NULL, 1, 'superadmin'), (9, 'Inactive', 'User', NULL, 0, 'usuario')")
    let previousWeek
    const last = new Map()
    for (let offset = 0; offset < 20; offset++) {
      const date = new Date(now.getTime() + offset * 7 * 86400000)
      const week = ensureCurrentWeek(db, date)
      assertAssignments(week, [1, 2, 3, 4, 5, 6, 7])
      for (const role of week.roles) {
        const day = Date.parse(role.date) / 86400000
        if (last.has(role.assigned_user)) assert.ok(day - last.get(role.assigned_user) >= 3)
        last.set(role.assigned_user, day)
      }
      assert.equal(week.generationBlocked, null)
      assert.deepEqual(ensureCurrentWeek(db, date), week)
      if (previousWeek) assert.deepEqual(listWeek(db, -1, date).roles, previousWeek.roles)
      previousWeek = week
    }
    for (let id = 1; id <= 7; id++) {
      assert.equal(db.prepare('SELECT ultimo_rol FROM users WHERE id = ?').get(id).ultimo_rol, db.prepare('SELECT max(date) AS date FROM roles WHERE assigned_user = ?').get(id).date)
    }
  } finally { db.close() }
})
test('generation never backfills missed past weeks', () => {
  const db = database()
  try {
    participants(db)
    const original = ensureCurrentWeek(db, now)
    const later = new Date(now.getTime() + 4 * 7 * 86400000)
    assertAssignments(ensureCurrentWeek(db, later), [1, 2, 3, 4, 5, 6, 7])
    for (const offset of [-1, -2, -3]) assert.deepEqual(listWeek(db, offset, later).roles, [])
    assert.deepEqual(listWeek(db, -4, later).roles, original.roles)
    assert.equal(db.prepare('SELECT count(*) AS n FROM roles').get().n, 14)
  } finally { db.close() }
})
test('open automatic weeks with repeats are replaced and blocked if eligibility falls below three', () => {
  const db = database()
  try {
    participants(db)
    for (let day = 0; day < 7; day++) db.prepare('INSERT INTO roles(date, assigned_user) VALUES (?, 1)').run(new Date(now.getTime() + day * 86400000).toISOString().slice(0, 10))
    assertAssignments(ensureCurrentWeek(db, now), [1, 2, 3, 4, 5, 6, 7])
    db.exec('UPDATE users SET activo = 0 WHERE id >= 3')
    assert.deepEqual(ensureCurrentWeek(db, now).roles, [])
    assert.equal(ensureCurrentWeek(db, now).generationBlocked, 'INSUFFICIENT_ACTIVE_USERS')
  } finally { db.close() }
})
