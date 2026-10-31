import { automaticLock } from '../server/week-locks.mjs'
import { reorganizedUsers, reorganizationWrites } from '../server/reorganization.mjs'
import { randomInt } from 'node:crypto'
import { weekRange } from '../server/roles.mjs'
import { todayInManagua } from '../server/notes.mjs'
import { canChangeUserRole } from '../src/helpers/user-role-policy.js'

const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }
const addDays = (date, count) => { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + count); return value.toISOString().slice(0, 10) }
export async function listWeekStarting(db, start, now) {
  const end = addDays(start, 6)
  const roles = await db.prepare(`SELECT r.*, a.nombre || ' ' || a.apellido AS assigned_name,
    b.nombre || ' ' || b.apellido AS replacement_name FROM roles r
    JOIN users a ON a.id = r.assigned_user LEFT JOIN users b ON b.id = r.replace_user
    WHERE r.date BETWEEN ? AND ? ORDER BY r.date, r.id`).all(start, end)
  return { start, end, roles, lock: start === weekRange(0, now).start ? await weekLock(db, start, now) : await db.prepare('SELECT * FROM week_locks WHERE week_start = ?').get(start) || null }
}
export const listWeek = (db, offset, now) => listWeekStarting(db, weekRange(offset, now).start, now)
export async function ensureCurrentWeek(db, now) {
  const range = weekRange(0, now)
  const lock = await weekLock(db, range.start, now)
  let generationBlocked = null
  const users = await db.prepare("SELECT id FROM users WHERE activo = 1 AND rol_usuario IN ('usuario', 'admin')").all()
  const eligible = new Set(users.map(user => user.id))
  let existing = await db.prepare('SELECT assigned_user, replace_user, rol_switched, date, manually_assigned FROM roles WHERE date BETWEEN ? AND ? ORDER BY date').all(range.start, range.end)
  const previousUser = (await db.prepare('SELECT assigned_user FROM roles WHERE date = ?').get(addDays(range.start, -1)))?.assigned_user
  const assigned = new Set(existing.map(role => role.assigned_user))
  const missing = existing.length === 7 && users.length <= 7 && users.some(user => !assigned.has(user.id))
  const invalid = !existing.some(role => role.manually_assigned) && (users.length < 2 || missing || existing.some((role, index) => !eligible.has(role.assigned_user)
    || (role.rol_switched && !eligible.has(role.replace_user)) || role.assigned_user === (index ? existing[index - 1].assigned_user : previousUser)))
  const writes = []
  if (!lock && existing.length && invalid) {
    writes.push(['DELETE FROM roles WHERE date BETWEEN ? AND ?', [range.start, range.end]])
    for (const id of new Set(existing.map(role => role.assigned_user))) writes.push([
      'UPDATE users SET ultimo_rol = (SELECT max(date) FROM roles WHERE assigned_user = users.id) WHERE id = ? AND ultimo_rol BETWEEN ? AND ?', [id, range.start, range.end],
    ])
    existing = []
  }
  if (!existing.length) {
    if (users.length >= 2) {
      const turns = new Map(users.map(user => [user.id, 0]))
      let last = previousUser
      for (let day = 0; day < 7; day++) {
        const candidates = users.filter(user => user.id !== last)
        const minimum = Math.min(...candidates.map(user => turns.get(user.id)))
        const pool = candidates.filter(user => turns.get(user.id) === minimum)
        const user = pool[randomInt(pool.length)]
        turns.set(user.id, turns.get(user.id) + 1)
        const date = addDays(range.start, day)
        writes.push(['INSERT INTO roles (date, assigned_user) VALUES (?, ?)', [date, user.id]], ['UPDATE users SET ultimo_rol = ? WHERE id = ?', [date, user.id]])
        last = user.id
      }
    } else generationBlocked = 'INSUFFICIENT_ACTIVE_USERS'
  }
  await db.atomic(writes)
  return { ...await listWeek(db, 0, now), generationBlocked }
}
async function ownedCurrentRole(db, id, userId, range) {
  const role = await db.prepare('SELECT * FROM roles WHERE id = ?').get(id)
  if (!role) fail(404, 'Asignación no encontrada')
  if (role.date < range.start || role.date > range.end) fail(403, 'Solo puede modificar la semana actual')
  const user = await db.prepare('SELECT activo, rol_usuario FROM users WHERE id = ?').get(userId)
  if (user?.rol_usuario === 'superadmin') return role
  if (role.assigned_user !== userId) fail(403, 'Solo puede modificar sus propias asignaciones')
  if (!user || user.activo !== 1 || !['usuario', 'admin'].includes(user.rol_usuario)) fail(403, 'No puede modificar esta asignación')
  return role
}
async function availableReplacements(db, role, range) {
  const participating = await db.prepare(`SELECT 1 FROM roles WHERE date BETWEEN ? AND ?
    AND (replace_user = ? OR (assigned_user = ? AND (rol_switched = 1 OR replace_user IS NOT NULL))) LIMIT 1`)
    .get(range.start, range.end, role.assigned_user, role.assigned_user)
  if (role.rol_switched || role.replace_user || participating) return []
  const users = await db.prepare(`SELECT u.id, u.nombre, u.apellido FROM users u
    WHERE u.activo = 1 AND u.rol_usuario IN ('usuario', 'admin') AND u.id != ?
      AND NOT EXISTS (SELECT 1 FROM roles r WHERE r.date BETWEEN ? AND ? AND r.replace_user = u.id)
      AND NOT EXISTS (SELECT 1 FROM roles r WHERE r.date BETWEEN ? AND ? AND r.assigned_user = u.id AND (r.rol_switched = 1 OR r.replace_user IS NOT NULL))
    ORDER BY u.nombre, u.apellido, u.id`).all(role.assigned_user, range.start, range.end, range.start, range.end)
  const days = await db.prepare('SELECT id, assigned_user, date FROM roles WHERE date BETWEEN ? AND ? ORDER BY date').all(range.start, range.end)
  return users.map(user => ({ ...user, days: days.filter(day => day.assigned_user === user.id).map(({ id, date }) => ({ id, date })) }))
}
export async function replacementOptions(db, id, userId, now) {
  const range = weekRange(0, now)
  return { users: await availableReplacements(db, await ownedCurrentRole(db, id, userId, range), range) }
}
export async function switchAssignment(db, id, userId, data, now) {
  if (typeof data?.rol_switched !== 'boolean') fail(400, 'Estado de sustitución inválido')
  if (data.rol_switched && !Number.isSafeInteger(data.replace_user)) fail(400, 'Seleccione un sustituto válido')
  const range = weekRange(0, now)
  const role = await ownedCurrentRole(db, id, userId, range)
  const writes = []
  if (data.rol_switched) {
    const replacement = (await availableReplacements(db, role, range)).find(user => user.id === data.replace_user)
    if (!replacement) fail(409, 'El sustituto ya no está disponible o existe una sustitución pendiente. Actualice las asignaciones.')
    const selected = data.replace_role_id ?? (replacement.days.length === 1 ? replacement.days[0].id : null)
    if (replacement.days.length > 1 && selected === null) fail(400, 'Seleccione el día del sustituto que cubrirá')
    if (selected !== null && (!Number.isSafeInteger(selected) || !replacement.days.some(day => day.id === selected))) fail(409, 'El día seleccionado no pertenece al sustituto o ya no está disponible')
    writes.push(['UPDATE roles SET rol_switched = 1, replace_user = ? WHERE id = ?', [data.replace_user, role.id]])
    if (selected !== null) writes.push(['UPDATE roles SET rol_switched = 1, replace_user = ? WHERE id = ?', [role.assigned_user, selected]])
  } else if (Object.hasOwn(data, 'expected_replace_user') && data.expected_replace_user !== role.replace_user) fail(409, 'La sustitución ha cambiado. Actualice las asignaciones antes de continuar.')
  else if (role.replace_user) writes.push([`UPDATE roles SET rol_switched = 0, replace_user = NULL WHERE date BETWEEN ? AND ?
    AND ((assigned_user = ? AND replace_user = ?) OR (assigned_user = ? AND replace_user = ?))`, [range.start, range.end, role.assigned_user, role.replace_user, role.replace_user, role.assigned_user]])
  else writes.push(['UPDATE roles SET rol_switched = 0, replace_user = NULL WHERE id = ?', [role.id]])
  await db.atomic(writes)
  return listWeek(db, 0, now)
}
export async function changeUserRole(db, actorId, targetId, data) {
  const actor = await db.prepare('SELECT rol_usuario, activo FROM users WHERE id = ?').get(actorId)
  if (!actor || (actor.rol_usuario !== 'superadmin' && actor.activo !== 1)) fail(403, 'No tiene permiso para modificar roles')
  const target = await db.prepare('SELECT id, username, rol_usuario FROM users WHERE id = ?').get(targetId)
  if (!target) fail(404, 'Usuario no encontrado')
  if (!canChangeUserRole(actor, target)) fail(403, 'Solo un superadmin puede modificar el rol de un administrador; las cuentas superadmin están protegidas')
  if (!['usuario', 'admin'].includes(data?.rol_usuario)) fail(400, 'Rol de usuario inválido')
  await db.prepare('UPDATE users SET rol_usuario = ? WHERE id = ?').run(data.rol_usuario, targetId)
  return { id: targetId, rol_usuario: data.rol_usuario }
}
const admin = user => ['admin', 'superadmin'].includes(user.rol_usuario)
function canComplete(note, user, today, role) {
  if (note.completed_at) return false
  if (note.date < today) return admin(user)
  return role ? role.assigned_user === user.id || Boolean(role.rol_switched && role.replace_user === user.id) : note.assigned_user === user.id
}
export async function listNotes(db, user, now) {
  const today = todayInManagua(now)
  const notes = await db.prepare(`SELECT n.*, u.nombre || ' ' || u.apellido AS assigned_name FROM notes n
    JOIN users u ON u.id = n.assigned_user WHERE NOT EXISTS (SELECT 1 FROM deleted_notes d WHERE d.note_id = n.id) ORDER BY n.date DESC, n.id DESC`).all()
  const entries = await db.prepare(`SELECT e.*, u.nombre || ' ' || u.apellido AS author_name FROM note_entries e
    JOIN users u ON u.id = e.author_id ORDER BY e.id`).all()
  const roles = await db.prepare('SELECT date, assigned_user, replace_user, rol_switched FROM roles WHERE date >= ?').all(today)
  const byDate = new Map(roles.map(role => [role.date, role]))
  const byNote = new Map()
  for (const entry of entries) { if (!byNote.has(entry.note_id)) byNote.set(entry.note_id, []); byNote.get(entry.note_id).push(entry) }
  return { today, pendingCount: notes.filter(note => !note.completed_at && note.date < today).length,
    notes: notes.map(note => ({ ...note, canDelete: user.rol_usuario === 'superadmin', overdue: !note.completed_at && note.date < today,
      canComplete: canComplete(note, user, today, byDate.get(note.date)), entries: byNote.get(note.id) || [] })) }
}
function textValue(data) {
  if (typeof data?.text !== 'string' || !data.text.trim() || data.text.trim().length > 4000) fail(400, 'Ingrese texto de 1 a 4000 caracteres')
  return data.text.trim()
}
async function getNote(db, id) {
  const note = await db.prepare('SELECT * FROM notes WHERE id = ? AND NOT EXISTS (SELECT 1 FROM deleted_notes d WHERE d.note_id = notes.id)').get(id)
  if (!note) fail(404, 'Nota no encontrada')
  if (note.completed_at) fail(409, 'La nota está completa y no se puede modificar')
  return note
}
export async function createNote(db, user, data) {
  const text = textValue(data), priority = data.priority ?? 'normal'
  if (!['normal', 'atencion', 'critical'].includes(priority)) fail(400, 'Prioridad inválida')
  const role = typeof data.date === 'string' && await db.prepare('SELECT * FROM roles WHERE date = ?').get(data.date)
  if (!role) fail(400, 'Seleccione un día con una asignación existente')
  if (data.parent_id != null) {
    if (!Number.isSafeInteger(data.parent_id)) fail(400, 'Nota de origen inválida')
    const parent = await db.prepare('SELECT completed_at FROM notes WHERE id = ? AND NOT EXISTS (SELECT 1 FROM deleted_notes d WHERE d.note_id = notes.id)').get(data.parent_id)
    if (!parent) fail(404, 'Nota de origen no encontrada')
    if (!parent.completed_at) fail(409, 'Solo se pueden derivar notas completas')
  }
  const results = await db.atomic([
    ['INSERT INTO notes(date, assigned_user, created_by, priority, parent_id) VALUES (?, ?, ?, ?, ?)', [role.date, role.rol_switched ? role.replace_user : role.assigned_user, user.id, priority, data.parent_id ?? null]],
    ['INSERT INTO note_entries(note_id, author_id, text) VALUES (last_insert_rowid(), ?, ?)', [user.id, text]],
  ])
  return { id: Number(results[0].lastInsertRowid) }
}
export async function appendNote(db, user, id, data) {
  const text = textValue(data)
  await getNote(db, id)
  await db.prepare('INSERT INTO note_entries(note_id, author_id, text) VALUES (?, ?, ?)').run(id, user.id, text)
  return { ok: true }
}
export async function completeNote(db, user, id, now) {
  const note = await getNote(db, id)
  const role = await db.prepare('SELECT assigned_user, replace_user, rol_switched FROM roles WHERE date = ?').get(note.date)
  if (!canComplete(note, user, todayInManagua(now), role)) fail(403, 'Solo el usuario asignado o su sustituto puede completar la nota; las notas vencidas requieren un administrador')
  await db.prepare("UPDATE notes SET completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), completed_by = ? WHERE id = ?").run(user.id, id)
  return { ok: true }
}
export async function clearPendingNotes(db, user, now) {
  if (!admin(user)) fail(403, 'Solo un administrador puede limpiar las notificaciones')
  const result = await db.prepare("UPDATE notes SET completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), completed_by = ? WHERE completed_at IS NULL AND date < ? AND NOT EXISTS (SELECT 1 FROM deleted_notes d WHERE d.note_id = notes.id)").run(user.id, todayInManagua(now))
  return { clearedCount: Number(result.changes) }
}

export async function reassignDay(db, actorId, roleId, data, now) {
  const range = weekRange(0, now)
  const actor = await db.prepare('SELECT rol_usuario FROM users WHERE id = ?').get(actorId)
  if (!['admin', 'superadmin'].includes(actor?.rol_usuario)) fail(403, 'No puede cambiar la asignación')
  const lock = await weekLock(db, range.start, now)
  if (actor.rol_usuario === 'admin' && lock) fail(409, 'La semana está cerrada')
  const role = await db.prepare('SELECT * FROM roles WHERE id = ?').get(roleId)
  if (!role) fail(404, 'Asignación no encontrada')
  if (role.date < range.start || role.date > range.end) fail(403, 'Solo puede cambiar asignaciones de la semana actual')
  if (!Number.isSafeInteger(data?.assigned_user)) fail(400, 'Seleccione un usuario válido')
  const target = await db.prepare("SELECT id FROM users WHERE id = ? AND activo = 1 AND rol_usuario IN ('usuario', 'admin')").get(data.assigned_user)
  if (!target) fail(400, 'Seleccione un usuario activo con rol usuario o admin')
  if ((Object.hasOwn(data, 'expected_assigned_user') && data.expected_assigned_user !== role.assigned_user)
    || (Object.hasOwn(data, 'expected_replace_user') && data.expected_replace_user !== role.replace_user))
    fail(409, 'La asignación ha cambiado. Cierre el diálogo y actualice los roles antes de continuar.')
  const writes = []
  if (target.id !== role.assigned_user) {
    if (role.replace_user) writes.push([`UPDATE roles SET rol_switched = 0, replace_user = NULL
      WHERE date BETWEEN ? AND ? AND ((assigned_user = ? AND replace_user = ?) OR (assigned_user = ? AND replace_user = ?))`,
      [range.start, range.end, role.assigned_user, role.replace_user, role.replace_user, role.assigned_user]])
    writes.push(
      ['UPDATE roles SET assigned_user = ?, replace_user = NULL, rol_switched = 0, manually_assigned = 1 WHERE id = ?', [target.id, role.id]],
      ['UPDATE users SET ultimo_rol = (SELECT max(date) FROM roles WHERE assigned_user = ?) WHERE id = ? AND ultimo_rol = ?', [role.assigned_user, role.assigned_user, role.date]],
      ['UPDATE users SET ultimo_rol = ? WHERE id = ? AND (ultimo_rol IS NULL OR ultimo_rol < ?)', [role.date, target.id, role.date]],
    )
  }
  await db.atomic(writes)
  return listWeek(db, 0, now)
}

export async function reorganizeWeek(db, actorId, now) {
  if ((await db.prepare('SELECT rol_usuario FROM users WHERE id = ?').get(actorId))?.rol_usuario !== 'superadmin')
    fail(403, 'Solo un superadmin puede reorganizar la semana')
  if (await weekLock(db, weekRange(0, now).start, now)) fail(409, 'La semana está cerrada y no se puede reorganizar')
  const range = weekRange(0, now)
  const existing = (await listWeek(db, 0, now)).roles
  const users = await db.prepare("SELECT id FROM users WHERE activo = 1 AND rol_usuario IN ('usuario', 'admin')").all()
  const previousUser = (await db.prepare('SELECT assigned_user FROM roles WHERE date = ?').get(addDays(range.start, -1)))?.assigned_user
  const assignments = reorganizedUsers(users, previousUser, existing)
  await db.atomic(reorganizationWrites(range, existing, assignments))
  return listWeek(db, 0, now)
}

export async function deleteNote(db, user, id) {
  if (user.rol_usuario !== 'superadmin') fail(403, 'Solo un superadmin puede eliminar notas')
  if (!await db.prepare('SELECT id FROM notes WHERE id = ?').get(id)) fail(404, 'Nota no encontrada')
  await db.prepare("INSERT OR IGNORE INTO deleted_notes VALUES (?, ?, ?)").run(id, user.id, new Date().toISOString())
  return { ok: true }
}

export async function weekLock(db, start, now) {
  const at = automaticLock(start, now)
  let lock = await db.prepare('SELECT * FROM week_locks WHERE week_start = ?').get(start)
  if (!lock && at) {
    await db.prepare("INSERT OR IGNORE INTO week_locks VALUES (?, 'automatic', NULL, 'Sistema', ?)").run(start, at)
    lock = await db.prepare('SELECT * FROM week_locks WHERE week_start = ?').get(start)
  }
  return lock || null
}
export async function lockWeek(db, actorId, now = new Date()) {
  const actor = await db.prepare('SELECT rol_usuario, nombre, apellido FROM users WHERE id = ?').get(actorId)
  if (!['admin', 'superadmin'].includes(actor?.rol_usuario)) fail(403, 'Solo un administrador puede cerrar la semana')
  const { start } = weekRange(0, now)
  await weekLock(db, start, now)
  await db.prepare("INSERT OR IGNORE INTO week_locks VALUES (?, 'manual', ?, ?, ?)").run(start, actorId, `${actor.nombre} ${actor.apellido}`, now.toISOString())
  return { lock: start === weekRange(0, now).start ? await weekLock(db, start, now) : await db.prepare('SELECT * FROM week_locks WHERE week_start = ?').get(start) || null }
}
