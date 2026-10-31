import { weekLock } from './week-locks.mjs'
import { randomInt } from 'node:crypto'
import { weekRange, listWeek } from './roles.mjs'

// Search balanced schedules in randomized order, excluding the saved distribution.
export function reorganizedUsers(users, previousUser, existing) {
  if (users.length < 2) throw Object.assign(new Error('Se necesitan al menos dos usuarios activos con rol usuario o admin'), { status: 409 })
  const turns = new Map(users.map(user => [user.id, 0]))
  function search(days) {
    if (days.length === 7) return days.some((id, index) => id !== existing[index]?.assigned_user) ? days : null
    const candidates = users.filter(user => user.id !== (days.length ? days.at(-1) : previousUser))
    const minimum = Math.min(...candidates.map(user => turns.get(user.id)))
    const pool = candidates.filter(user => turns.get(user.id) === minimum)
    while (pool.length) {
      const [user] = pool.splice(randomInt(pool.length), 1)
      turns.set(user.id, turns.get(user.id) + 1)
      const result = search([...days, user.id])
      turns.set(user.id, turns.get(user.id) - 1)
      if (result) return result
    }
    return null
  }
  const result = search([])
  if (!result) throw Object.assign(new Error('No existe otra distribución válida con los participantes actuales'), { status: 409 })
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
    // Only the immediately preceding day constrains adjacency.
    const yesterday = new Date(`${range.start}T12:00:00Z`); yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    const previousUser = db.prepare('SELECT assigned_user FROM roles WHERE date = ?').get(yesterday.toISOString().slice(0, 10))?.assigned_user
    const assignments = reorganizedUsers(users, previousUser, existing)
    for (const [sql, args] of reorganizationWrites(range, existing, assignments)) db.prepare(sql).run(...args)
    const result = listWeek(db, 0, now)
    db.exec('COMMIT')
    return result
  } catch (error) { db.exec('ROLLBACK'); throw error }
}
