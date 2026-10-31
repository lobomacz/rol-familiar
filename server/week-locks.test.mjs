import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from './database.mjs'
import { lockWeek, automaticLock } from './week-locks.mjs'
import { ensureCurrentWeek } from './roles.mjs'
import { reorganizeWeek } from './reorganization.mjs'
import { reassignDay } from './reassignments.mjs'
import { createNote, completeNote, deleteNote, listNotes, appendNote } from './notes.mjs'
import { switchAssignment, replacementOptions } from './role-swaps.mjs'
import * as cloud from '../cloudflare/services.mjs'
const monday = new Date('2026-10-26T18:00:00Z')
const wednesday = new Date('2026-10-28T06:00:00Z')
const local = { lockWeek, ensureCurrentWeek, reorganizeWeek, reassignDay, createNote, completeNote, deleteNote, listNotes, appendNote, switchAssignment, replacementOptions }
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'locks-'))
  const previous = process.env.SQLITE_PATH
  process.env.SQLITE_PATH = join(directory, 'test.sqlite')
  const db = openDatabase()
  if (previous === undefined) delete process.env.SQLITE_PATH; else process.env.SQLITE_PATH = previous
  for (const [id, role] of [[1, 'superadmin'], [2, 'admin'], [3, 'usuario'], [4, 'usuario']])
    db.prepare('INSERT INTO users(id, username, password_hash, nombre, apellido, rol_usuario) VALUES (?, ?, ?, ?, ?, ?)').run(id, `u${id}`, 'unused', `Name${id}`, 'Family', role)
  db.atomic = queries => {
    db.exec('BEGIN IMMEDIATE')
    try { const results = queries.map(([sql, args]) => db.prepare(sql).run(...args)); db.exec('COMMIT'); return results }
    catch (error) { db.exec('ROLLBACK'); throw error }
  }
  return { db, close() { db.close(); rmSync(directory, { recursive: true, force: true }) } }
}
const rejects = (action, status) => assert.rejects(async () => action(), { status })
for (const [name, service] of [['SQLite', local], ['D1 service', cloud]]) {
  test(`${name}: manual locks record the actor, block reshuffling and admin edits, preserve superadmin edits and exchanges`, async () => {
    const f = fixture(), db = f.db
    try {
      const week = await service.ensureCurrentWeek(db, monday)
      await rejects(() => service.lockWeek(db, 3, monday), 403)
      const role = week.roles[0], target = role.assigned_user === 3 ? 4 : 3
      await service.reassignDay(db, 2, role.id, { assigned_user: target }, monday)
      const { lock } = await service.lockWeek(db, 2, monday)
      assert.equal(lock.lock_type, 'manual'); assert.equal(lock.locked_by, 2)
      assert.equal(lock.author, 'Name2 Family'); assert.equal(lock.locked_at, monday.toISOString())
      assert.deepEqual((await service.lockWeek(db, 1, wednesday)).lock, lock)
      await rejects(() => service.reorganizeWeek(db, 1, monday), 409)
      await rejects(() => service.reassignDay(db, 2, role.id, { assigned_user: 2 }, monday), 409)
      await service.reassignDay(db, 1, role.id, { assigned_user: 3 }, monday)
      const options = await service.replacementOptions(db, role.id, 3, monday)
      const replacement = options.users[0]
      await service.switchAssignment(db, role.id, 3, { rol_switched: true, replace_user: replacement.id, replace_role_id: replacement.days[0]?.id }, monday)
      assert.equal(db.prepare('SELECT rol_switched FROM roles WHERE id = ?').get(role.id).rol_switched, 1)
      db.exec('UPDATE users SET activo = 0 WHERE id = 4')
      const snapshot = db.prepare('SELECT * FROM roles ORDER BY id').all()
      await service.ensureCurrentWeek(db, monday)
      assert.deepEqual(db.prepare('SELECT * FROM roles ORDER BY id').all(), snapshot)
    } finally { f.close() }
  })
  test(`${name}: automatic lock starts exactly Wednesday Managua midnight and does not affect next week`, async () => {
    const f = fixture(), db = f.db
    try {
      assert.equal((await service.ensureCurrentWeek(db, new Date(wednesday.getTime() - 1))).lock, null)
      const before = db.prepare('SELECT * FROM roles ORDER BY id').all()
      await rejects(() => service.reorganizeWeek(db, 1, wednesday), 409)
      const week = await service.ensureCurrentWeek(db, wednesday)
      assert.equal(week.lock.author, 'Sistema'); assert.equal(week.lock.locked_by, null)
      assert.equal(week.lock.lock_type, 'automatic'); assert.equal(week.lock.locked_at, wednesday.toISOString())
      assert.deepEqual(db.prepare('SELECT * FROM roles ORDER BY id').all(), before)
      assert.equal((await service.ensureCurrentWeek(db, new Date('2026-11-02T18:00:00Z'))).lock, null)
    } finally { f.close() }
  })
  test(`${name}: only superadmins can delete pending and completed historical notes, preserving derived notes`, async () => {
    const f = fixture(), db = f.db
    try {
      const week = await service.ensureCurrentWeek(db, monday)
      const member = { id: 3, rol_usuario: 'usuario' }, admin = { id: 2, rol_usuario: 'admin' }, root = { id: 1, rol_usuario: 'superadmin' }
      const first = await service.createNote(db, member, { date: week.start, text: 'Original' })
      await service.completeNote(db, admin, first.id, wednesday)
      const derived = await service.createNote(db, member, { date: week.start, text: 'Derived', parent_id: first.id })
      await rejects(() => service.deleteNote(db, member, first.id), 403)
      await rejects(() => service.deleteNote(db, admin, first.id), 403)
      await service.deleteNote(db, root, first.id)
      const notes = (await service.listNotes(db, root, new Date('2026-11-10T18:00:00Z'))).notes
      assert.equal(notes.length, 1); assert.equal(notes[0].id, derived.id); assert.equal(notes[0].parent_id, first.id)
      await rejects(() => service.appendNote(db, member, first.id, { text: 'Hidden' }), 404)
      await service.deleteNote(db, root, derived.id)
      assert.equal((await service.listNotes(db, root, wednesday)).pendingCount, 0)
    } finally { f.close() }
  })
}
test('automatic cutoff uses Managua dates across year boundaries', () => {
  assert.equal(automaticLock('2026-12-28', new Date('2026-12-30T05:59:59Z')), null)
  assert.equal(automaticLock('2026-12-28', new Date('2026-12-30T06:00:00Z')), '2026-12-30T06:00:00.000Z')
})
