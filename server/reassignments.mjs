import { weekLock } from './week-locks.mjs'
import { listWeek, weekRange } from './roles.mjs'
const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }
export function reassignDay(db, actorId, roleId, data, now) {
  const range = weekRange(0, now)
  weekLock(db, range.start, now)
  db.exec('BEGIN IMMEDIATE')
  try {
    const actor = db.prepare('SELECT rol_usuario FROM users WHERE id = ?').get(actorId)
    if (!['admin', 'superadmin'].includes(actor?.rol_usuario)) fail(403, 'No puede cambiar la asignación')
    if (actor.rol_usuario === 'admin' && weekLock(db, range.start, now)) fail(409, 'La semana está cerrada')
    const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(roleId)
    if (!role) fail(404, 'Asignación no encontrada')
    if (role.date < range.start || role.date > range.end) fail(403, 'Solo puede cambiar asignaciones de la semana actual')
    if (!Number.isSafeInteger(data?.assigned_user)) fail(400, 'Seleccione un usuario válido')
    const target = db.prepare("SELECT id FROM users WHERE id = ? AND activo = 1 AND rol_usuario IN ('usuario', 'admin')").get(data.assigned_user)
    if (!target) fail(400, 'Seleccione un usuario activo con rol usuario o admin')
    if ((Object.hasOwn(data, 'expected_assigned_user') && data.expected_assigned_user !== role.assigned_user)
      || (Object.hasOwn(data, 'expected_replace_user') && data.expected_replace_user !== role.replace_user))
      fail(409, 'La asignación ha cambiado. Cierre el diálogo y actualice los roles antes de continuar.')
    if (target.id !== role.assigned_user) {
      // Remove the reciprocal swap too, so the other participant is not left covering an orphaned exchange.
      if (role.replace_user) db.prepare(`UPDATE roles SET rol_switched = 0, replace_user = NULL
        WHERE date BETWEEN ? AND ? AND ((assigned_user = ? AND replace_user = ?) OR (assigned_user = ? AND replace_user = ?))`)
        .run(range.start, range.end, role.assigned_user, role.replace_user, role.replace_user, role.assigned_user)
      db.prepare('UPDATE roles SET assigned_user = ?, replace_user = NULL, rol_switched = 0, manually_assigned = 1 WHERE id = ?').run(target.id, role.id)
      db.prepare(`UPDATE users SET ultimo_rol = (SELECT max(date) FROM roles WHERE assigned_user = ?) WHERE id = ? AND ultimo_rol = ?`)
        .run(role.assigned_user, role.assigned_user, role.date)
      db.prepare('UPDATE users SET ultimo_rol = ? WHERE id = ? AND (ultimo_rol IS NULL OR ultimo_rol < ?)').run(role.date, target.id, role.date)
    }
    const week = listWeek(db, 0, now)
    db.exec('COMMIT')
    return week
  } catch (error) { db.exec('ROLLBACK'); throw error }
}
