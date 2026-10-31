const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }
export const todayInManagua = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Managua', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  return ['year', 'month', 'day'].map(key => parts.find(part => part.type === key).value).join('-')
}
const admin = user => ['admin', 'superadmin'].includes(user.rol_usuario)
function canComplete(db, note, user, today) {
  if (note.completed_at) return false
  if (note.date < today) return admin(user)
  const role = db.prepare('SELECT assigned_user, replace_user, rol_switched FROM roles WHERE date = ?').get(note.date)
  return role ? role.assigned_user === user.id || Boolean(role.rol_switched && role.replace_user === user.id) : note.assigned_user === user.id
}
export function listNotes(db, user, now) {
  const today = todayInManagua(now)
  const notes = db.prepare(`SELECT n.*, u.nombre || ' ' || u.apellido AS assigned_name FROM notes n
    JOIN users u ON u.id = n.assigned_user WHERE NOT EXISTS (SELECT 1 FROM deleted_notes d WHERE d.note_id = n.id) ORDER BY n.date DESC, n.id DESC`).all()
  const entries = db.prepare(`SELECT e.*, u.nombre || ' ' || u.apellido AS author_name FROM note_entries e
    JOIN users u ON u.id = e.author_id ORDER BY e.id`).all()
  return { today, pendingCount: notes.filter(n => !n.completed_at && n.date < today).length,
    notes: notes.map(note => ({ ...note, canDelete: user.rol_usuario === 'superadmin', overdue: !note.completed_at && note.date < today,
      canComplete: canComplete(db, note, user, today),
      entries: entries.filter(entry => entry.note_id === note.id) })) }
}
const textValue = data => {
  if (typeof data?.text !== 'string' || !data.text.trim() || data.text.trim().length > 4000) fail(400, 'Ingrese texto de 1 a 4000 caracteres')
  return data.text.trim()
}
const getNote = (db, id) => {
  const note = db.prepare('SELECT * FROM notes WHERE id = ? AND NOT EXISTS (SELECT 1 FROM deleted_notes d WHERE d.note_id = notes.id)').get(id)
  if (!note) fail(404, 'Nota no encontrada')
  if (note.completed_at) fail(409, 'La nota está completa y no se puede modificar')
  return note
}
export function createNote(db, user, data) {
  const text = textValue(data)
  const priority = data.priority ?? 'normal'
  if (!['normal', 'atencion', 'critical'].includes(priority)) fail(400, 'Prioridad inválida')
  const role = typeof data.date === 'string' && db.prepare('SELECT * FROM roles WHERE date = ?').get(data.date)
  if (!role) fail(400, 'Seleccione un día con una asignación existente')
  db.exec('BEGIN IMMEDIATE')
  try {
    if (data.parent_id != null) {
      if (!Number.isSafeInteger(data.parent_id)) fail(400, 'Nota de origen inválida')
      const parent = db.prepare('SELECT completed_at FROM notes WHERE id = ? AND NOT EXISTS (SELECT 1 FROM deleted_notes d WHERE d.note_id = notes.id)').get(data.parent_id)
      if (!parent) fail(404, 'Nota de origen no encontrada')
      if (!parent.completed_at) fail(409, 'Solo se pueden derivar notas completas')
    }
    const result = db.prepare('INSERT INTO notes(date, assigned_user, created_by, priority, parent_id) VALUES (?, ?, ?, ?, ?)')
      .run(role.date, role.rol_switched ? role.replace_user : role.assigned_user, user.id, priority, data.parent_id ?? null)
    db.prepare('INSERT INTO note_entries(note_id, author_id, text) VALUES (?, ?, ?)').run(result.lastInsertRowid, user.id, text)
    db.exec('COMMIT')
    return { id: Number(result.lastInsertRowid) }
  } catch (error) { db.exec('ROLLBACK'); throw error }
}
export function appendNote(db, user, id, data) {
  const text = textValue(data)
  getNote(db, id)
  db.prepare('INSERT INTO note_entries(note_id, author_id, text) VALUES (?, ?, ?)').run(id, user.id, text)
  return { ok: true }
}
export function completeNote(db, user, id, now) {
  const note = getNote(db, id)
  if (!canComplete(db, note, user, todayInManagua(now)))
    fail(403, 'Solo el usuario asignado o su sustituto puede completar la nota; las notas vencidas requieren un administrador')
  db.prepare("UPDATE notes SET completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), completed_by = ? WHERE id = ?").run(user.id, id)
  return { ok: true }
}

export function clearPendingNotes(db, user, now) {
  if (!admin(user)) fail(403, 'Solo un administrador puede limpiar las notificaciones')
  const result = db.prepare(`UPDATE notes SET completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), completed_by = ?
    WHERE completed_at IS NULL AND date < ? AND NOT EXISTS (SELECT 1 FROM deleted_notes d WHERE d.note_id = notes.id)`).run(user.id, todayInManagua(now))
  return { clearedCount: Number(result.changes) }
}

export function deleteNote(db, user, id) {
  if (user.rol_usuario !== 'superadmin') fail(403, 'Solo un superadmin puede eliminar notas')
  if (!db.prepare('SELECT id FROM notes WHERE id = ?').get(id)) fail(404, 'Nota no encontrada')
  db.prepare("INSERT OR IGNORE INTO deleted_notes VALUES (?, ?, ?)").run(id, user.id, new Date().toISOString())
  return { ok: true }
}
