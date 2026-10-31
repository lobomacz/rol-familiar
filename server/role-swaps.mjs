import { listWeek, weekRange } from './roles.mjs'

const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }
function ownedCurrentRole(db, roleId, userId, range) {
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(roleId)
  if (!role) fail(404, 'Asignación no encontrada')
  if (role.assigned_user !== userId) fail(403, 'Solo puede modificar sus propias asignaciones')
  if (role.date < range.start || role.date > range.end) fail(403, 'Solo puede modificar la semana actual')
  const user = db.prepare('SELECT activo, rol_usuario FROM users WHERE id = ?').get(userId)
  if (!user || user.activo !== 1 || !['usuario', 'admin'].includes(user.rol_usuario)) fail(403, 'No puede modificar esta asignación')
  return role
}
function availableReplacements(db, role, range) {
  // Reserve both participants across the week, including their other assigned days.
  const participating = db.prepare(`SELECT 1 FROM roles WHERE date BETWEEN ? AND ?
    AND (replace_user = ? OR (assigned_user = ? AND (rol_switched = 1 OR replace_user IS NOT NULL))) LIMIT 1`)
    .get(range.start, range.end, role.assigned_user, role.assigned_user)
  if (role.rol_switched || role.replace_user || participating) return []
  const users = db.prepare(`SELECT u.id, u.nombre, u.apellido FROM users u
    WHERE u.activo = 1 AND u.rol_usuario IN ('usuario', 'admin') AND u.id != ?
      AND NOT EXISTS (SELECT 1 FROM roles r WHERE r.date BETWEEN ? AND ? AND r.replace_user = u.id)
      AND NOT EXISTS (SELECT 1 FROM roles r WHERE r.date BETWEEN ? AND ? AND r.assigned_user = u.id AND (r.rol_switched = 1 OR r.replace_user IS NOT NULL))
    ORDER BY u.nombre, u.apellido, u.id`).all(role.assigned_user, range.start, range.end, range.start, range.end)
  const days = db.prepare('SELECT id, date FROM roles WHERE assigned_user = ? AND date BETWEEN ? AND ? ORDER BY date')
  return users.map(user => ({ ...user, days: days.all(user.id, range.start, range.end) }))
}
export function replacementOptions(db, roleId, userId, now) {
  const range = weekRange(0, now)
  const role = ownedCurrentRole(db, roleId, userId, range)
  return { users: availableReplacements(db, role, range) }
}
export function switchAssignment(db, roleId, userId, data, now) {
  if (typeof data?.rol_switched !== 'boolean') fail(400, 'Estado de sustitución inválido')
  if (data.rol_switched && !Number.isSafeInteger(data.replace_user)) fail(400, 'Seleccione un sustituto válido')
  const range = weekRange(0, now)
  db.exec('BEGIN IMMEDIATE')
  try {
    const role = ownedCurrentRole(db, roleId, userId, range)
    if (data.rol_switched) {
      const replacement = availableReplacements(db, role, range).find(user => user.id === data.replace_user)
      if (!replacement) fail(409, 'El sustituto ya no está disponible o existe una sustitución pendiente. Actualice las asignaciones.')
      const selectedDay = data.replace_role_id ?? (replacement.days.length === 1 ? replacement.days[0].id : null)
      if (replacement.days.length > 1 && selectedDay === null) fail(400, 'Seleccione el día del sustituto que cubrirá')
      if (selectedDay !== null && (!Number.isSafeInteger(selectedDay) || !replacement.days.some(day => day.id === selectedDay)))
        fail(409, 'El día seleccionado no pertenece al sustituto o ya no está disponible')
      db.prepare('UPDATE roles SET rol_switched = 1, replace_user = ? WHERE id = ?').run(data.replace_user, role.id)
      if (selectedDay !== null) db.prepare('UPDATE roles SET rol_switched = 1, replace_user = ? WHERE id = ?').run(userId, selectedDay)
    } else if (Object.hasOwn(data, 'expected_replace_user') && data.expected_replace_user !== role.replace_user) {
      fail(409, 'La sustitución ha cambiado. Actualice las asignaciones antes de continuar.')
    } else if (role.replace_user) {
      // Both owners may undo the pair, including all reciprocal days for the replacement.
      db.prepare(`UPDATE roles SET rol_switched = 0, replace_user = NULL
        WHERE date BETWEEN ? AND ? AND ((assigned_user = ? AND replace_user = ?) OR (assigned_user = ? AND replace_user = ?))`)
        .run(range.start, range.end, userId, role.replace_user, role.replace_user, userId)
    } else {
      db.prepare('UPDATE roles SET rol_switched = 0, replace_user = NULL WHERE id = ?').run(role.id)
    }
    const week = listWeek(db, 0, now)
    db.exec('COMMIT')
    return week
  } catch (error) { db.exec('ROLLBACK'); throw error }
}
