import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from './database.mjs'
import { appendNote, completeNote, createNote, listNotes, todayInManagua, clearPendingNotes } from './notes.mjs'

test('notes preserve appended text, assignment, links, overdue permissions and completed locks', () => {
  const directory = mkdtempSync(join(tmpdir(), 'notes-test-'))
  const previous = process.env.SQLITE_PATH
  process.env.SQLITE_PATH = join(directory, 'test.sqlite')
  let db
  try {
    db = openDatabase()
    for (const id of [1, 2, 3, 4]) db.prepare('INSERT INTO users(id, username, password_hash, nombre, apellido, rol_usuario) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, `user${id}`, 'unused', `Name${id}`, 'Family', id === 3 ? 'admin' : id === 4 ? 'superadmin' : 'usuario')
    db.prepare("INSERT INTO roles(date, assigned_user) VALUES ('2026-10-30', 1)").run()
    db.prepare("INSERT INTO roles(date, assigned_user, replace_user, rol_switched) VALUES ('2026-10-31', 1, 2, 1)").run()
    const owner = { id: 1, rol_usuario: 'usuario' }, other = { id: 2, rol_usuario: 'usuario' }
    const admin = { id: 3, rol_usuario: 'admin' }, superadmin = { id: 4, rol_usuario: 'superadmin' }
    const now = new Date('2026-10-30T18:00:00Z'), tomorrow = new Date('2026-10-31T06:00:00Z')
    assert.equal(todayInManagua(new Date('2026-10-31T05:59:59Z')), '2026-10-30')
    assert.equal(todayInManagua(tomorrow), '2026-10-31')
    const { id } = createNote(db, other, { date: '2026-10-30', text: 'Original', priority: 'atencion' })
    appendNote(db, owner, id, { text: 'Added' })
    const child = createNote(db, owner, { date: '2026-10-31', text: 'Follow-up', priority: 'critical' })
    const current = listNotes(db, owner, now)
    const note = current.notes.find(n => n.id === id)
    assert.deepEqual(note.entries.map(e => e.text), ['Original', 'Added'])
    assert.equal(note.canComplete, true)
    assert.equal(current.pendingCount, 0)
    assert.equal(current.notes.find(n => n.id === child.id).assigned_user, 2)
    assert.equal(current.notes.find(n => n.id === child.id).parent_id, null)
    const beforeDerivation = db.prepare('SELECT * FROM notes ORDER BY id').all()
    const entriesBeforeDerivation = db.prepare('SELECT * FROM note_entries ORDER BY id').all()
    assert.throws(() => createNote(db, owner, { date: '2026-10-31', text: 'Pending source', parent_id: id }), { status: 409 })
    assert.deepEqual(db.prepare('SELECT * FROM notes ORDER BY id').all(), beforeDerivation)
    assert.deepEqual(db.prepare('SELECT * FROM note_entries ORDER BY id').all(), entriesBeforeDerivation)
    // Both participants can act on a swapped day, even for notes created before the swap.
    assert.equal(current.notes.find(n => n.id === child.id).canComplete, true)
    assert.equal(listNotes(db, other, now).notes.find(n => n.id === child.id).canComplete, true)
    assert.equal(listNotes(db, superadmin, now).notes.find(n => n.id === child.id).canComplete, false)
    assert.throws(() => completeNote(db, superadmin, child.id, now), { status: 403 })
    db.prepare("UPDATE roles SET replace_user = 3 WHERE date = '2026-10-31'").run()
    assert.equal(listNotes(db, other, now).notes.find(n => n.id === child.id).canComplete, false)
    assert.throws(() => completeNote(db, other, child.id, now), { status: 403 })
    assert.equal(listNotes(db, admin, now).notes.find(n => n.id === child.id).canComplete, true)
    const replacementNote = createNote(db, owner, { date: '2026-10-31', text: 'Replacement completes' })
    completeNote(db, admin, replacementNote.id, now)
    const assignedNote = createNote(db, other, { date: '2026-10-31', text: 'Assigned user completes' })
    completeNote(db, owner, assignedNote.id, now)
    db.prepare("UPDATE roles SET replace_user = NULL, rol_switched = 0 WHERE date = '2026-10-31'").run()
    assert.equal(listNotes(db, admin, now).notes.find(n => n.id === child.id).canComplete, false)

    assert.throws(() => completeNote(db, other, id, now), { status: 403 })
    assert.throws(() => completeNote(db, admin, id, now), { status: 403 })
    assert.equal(listNotes(db, owner, tomorrow).pendingCount, 1)
    assert.equal(listNotes(db, owner, tomorrow).notes.find(n => n.id === id).canComplete, false)
    assert.throws(() => completeNote(db, owner, id, tomorrow), { status: 403 })
    completeNote(db, admin, id, tomorrow)
    assert.equal(listNotes(db, other, tomorrow).pendingCount, 0)
    assert.throws(() => appendNote(db, other, id, { text: 'No' }), { status: 409 })
    const originalNote = db.prepare('SELECT * FROM notes WHERE id = ?').get(id)
    const originalEntries = db.prepare('SELECT * FROM note_entries WHERE note_id = ? ORDER BY id').all(id)
    const derived = createNote(db, other, { date: '2026-10-31', text: 'New linked note', parent_id: id })
    const derivedNote = listNotes(db, other, tomorrow).notes.find(n => n.id === derived.id)
    assert.equal(derivedNote.parent_id, id)
    assert.equal(derivedNote.completed_at, null)
    assert.equal(derivedNote.completed_by, null)
    assert.deepEqual(derivedNote.entries.map(e => e.text), ['New linked note'])
    appendNote(db, owner, derived.id, { text: 'Additional text on derived note' })
    assert.deepEqual(db.prepare('SELECT * FROM notes WHERE id = ?').get(id), originalNote)
    assert.deepEqual(db.prepare('SELECT * FROM note_entries WHERE note_id = ? ORDER BY id').all(id), originalEntries)
    assert.throws(() => createNote(db, other, { date: '2026-10-31', text: 'Missing source', parent_id: 99999 }), { status: 404 })
    assert.throws(() => completeNote(db, admin, id, tomorrow), { status: 409 })
    assert.throws(() => db.prepare('UPDATE notes SET completed_at = NULL, completed_by = NULL WHERE id = ?').run(id), /immutable/)
    assert.throws(() => db.prepare('DELETE FROM notes WHERE id = ?').run(id), /deleted/)
    assert.throws(() => db.prepare("UPDATE note_entries SET text = 'Changed' WHERE note_id = ?").run(id), /append only/)
    assert.throws(() => db.prepare("INSERT INTO note_entries(note_id, author_id, text) VALUES (?, 1, 'No')").run(id), /immutable/)
    completeNote(db, superadmin, child.id, new Date('2026-11-01T18:00:00Z'))
    assert.throws(() => createNote(db, owner, { date: '2026-11-02', text: 'No assignment' }), { status: 400 })
    assert.throws(() => createNote(db, owner, { date: '2026-10-30', text: ' ', priority: 'normal' }), { status: 400 })
    assert.throws(() => createNote(db, owner, { date: '2026-10-30', text: 'Text', priority: 'invalid' }), { status: 400 })
    db.close(); db = openDatabase()
    assert.equal(listNotes(db, owner, tomorrow).notes.length, 5)
    assert.equal(db.prepare("SELECT count(*) AS count FROM schema_migrations WHERE name = 'notes-and-append-only-entries-v1'").get().count, 1)
  } finally {
    db?.close()
    if (previous === undefined) delete process.env.SQLITE_PATH
    else process.env.SQLITE_PATH = previous
    rmSync(directory, { recursive: true, force: true })
  }
})

test('clearing notifications is admin-only and completes only overdue pending notes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'clear-notes-test-'))
  const previous = process.env.SQLITE_PATH
  process.env.SQLITE_PATH = join(directory, 'test.sqlite')
  let db
  try {
    db = openDatabase()
    for (const id of [1, 2, 3]) db.prepare('INSERT INTO users(id, username, password_hash, nombre, apellido) VALUES (?, ?, ?, ?, ?)').run(id, `u${id}`, 'unused', 'Name', 'Family')
    for (const date of ['2026-10-29', '2026-10-30', '2026-10-31']) db.prepare('INSERT INTO roles(date, assigned_user) VALUES (?, 1)').run(date)
    const owner = { id: 1, rol_usuario: 'usuario' }, admin = { id: 2, rol_usuario: 'admin' }, superadmin = { id: 3, rol_usuario: 'superadmin' }
    const now = new Date('2026-10-30T18:00:00Z')
    const create = date => createNote(db, owner, { date, text: 'Preserve this text' }).id
    const completed = create('2026-10-29')
    completeNote(db, owner, completed, new Date('2026-10-29T18:00:00Z'))
    const originalCompletion = db.prepare('SELECT completed_at FROM notes WHERE id = ?').get(completed).completed_at
    const overdue = [create('2026-10-29'), create('2026-10-29')]
    const current = create('2026-10-30'), future = create('2026-10-31')
    assert.throws(() => clearPendingNotes(db, owner, now), { status: 403 })
    assert.equal(listNotes(db, admin, now).pendingCount, 2)
    assert.deepEqual(clearPendingNotes(db, admin, now), { clearedCount: 2 })
    assert.equal(listNotes(db, admin, now).pendingCount, 0)
    for (const id of overdue) {
      assert.equal(db.prepare('SELECT completed_by FROM notes WHERE id = ?').get(id).completed_by, 2)
      assert.throws(() => appendNote(db, owner, id, { text: 'Locked' }), { status: 409 })
    }
    for (const id of [current, future]) assert.equal(db.prepare('SELECT completed_at FROM notes WHERE id = ?').get(id).completed_at, null)
    assert.equal(db.prepare('SELECT completed_at FROM notes WHERE id = ?').get(completed).completed_at, originalCompletion)
    assert.equal(db.prepare('SELECT count(*) AS total FROM note_entries').get().total, 5)
    assert.deepEqual(clearPendingNotes(db, superadmin, now), { clearedCount: 0 })
    create('2026-10-29')
    assert.deepEqual(clearPendingNotes(db, superadmin, now), { clearedCount: 1 })
  } finally {
    db?.close()
    if (previous === undefined) delete process.env.SQLITE_PATH
    else process.env.SQLITE_PATH = previous
    rmSync(directory, { recursive: true, force: true })
  }
})
