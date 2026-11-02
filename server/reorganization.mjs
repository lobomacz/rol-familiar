import { weekLock } from './week-locks.mjs'
import { assignmentSchedule } from './assignment-schedule.mjs'
import { weekRange, listWeek } from './roles.mjs'

// Search balanced schedules in randomized order, excluding the saved distribution.
export function reorganizedUsers(users, start, history, existing) {
  const result = assignmentSchedule(users, start, history, existing)
  if (!result) throw Object.assign(new Error('No existe otra distribución válida. Se necesitan al menos tres participantes activos y dos días libres entre asignaciones. Solo se repiten usuarios cuando hay menos de siete participantes activos.'), { status: 409 })
  return result
}
export function reorganizationWrites(range, existing, assignments) {
  const writes = []
  for (let index = 0; index < 7; index++) {
    const date = new Date(`${range.start}T12:00:00Z`)
    date.setUTCDate(date.getUTCDate() + index)
    writes.push([`INSERT INTO roles(date, assigned_user) VALUES (?, ?)
      ON CONFLICT(date) DO UPDATE SET assigned_user = excluded.assigned_user, replace_user = NULL, rol_switched = 0, manually_assigned = 0`,
    [date.toISOString().slice(0, 10), assignments[index]]])
  }
  for (const id of new Set([...existing.map(role => role.assigned_user), ...assignments])) {
    writes.push([`UPDATE users SET ultimo_rol = (SELECT max(date) FROM roles WHERE assigned_user = ?)
      WHERE id = ? AND (ultimo_rol IS NULL OR ultimo_rol <= ?)`, [id, id, range.end]])
  }
  return writes
}
export function reorganizeWeek(db, actorId, now) {
  if (db.prepare('SELECT rol_usuario FROM users WHERE id = ?').get(actorId)?.rol_usuario !== 'superadmin')
    throw Object.assign(new Error('Solo un superadmin puede reorganizar la semana'), { status: 403 })
  const range = weekRange(0, now)
  if (weekLock(db, range.start, now)) throw Object.assign(new Error('La semana está cerrada y no se puede reorganizar'), { status: 409 })
  db.exec('BEGIN IMMEDIATE')
  try {
    if (db.prepare('SELECT rol_usuario FROM users WHERE id = ?').get(actorId)?.rol_usuario !== 'superadmin')
      throw Object.assign(new Error('Solo un superadmin puede reorganizar la semana'), { status: 403 })
    if (weekLock(db, range.start, now)) throw Object.assign(new Error('La semana está cerrada y no se puede reorganizar'), { status: 409 })
    const existing = listWeek(db, 0, now).roles
    const users = db.prepare("SELECT id FROM users WHERE activo = 1 AND rol_usuario IN ('usuario', 'admin')").all()
    const history = db.prepare('SELECT assigned_user, date FROM roles WHERE date < ? OR date > ? ORDER BY date').all(range.start, range.end)
    const assignments = reorganizedUsers(users, range.start, history, existing)
    for (const [sql, args] of reorganizationWrites(range, existing, assignments)) db.prepare(sql).run(...args)
    const result = listWeek(db, 0, now)
    db.exec('COMMIT')
    return result
  } catch (error) { db.exec('ROLLBACK'); throw error }
}
