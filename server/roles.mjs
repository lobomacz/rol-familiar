import { weekLock } from './week-locks.mjs'
import { assignmentSchedule, hasAssignmentViolation, minimumWeeklyParticipants, monthlyCoverage } from './assignment-schedule.mjs'

const addDays = (date, days) => {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}
export function weekRange(offset = 0, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Managua', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const part = name => parts.find(item => item.type === name).value
  const today = `${part('year')}-${part('month')}-${part('day')}`
  const day = new Date(`${today}T12:00:00Z`).getUTCDay()
  const start = addDays(today, -((day + 6) % 7) + offset * 7)
  return { start, end: addDays(start, 6) }
}
export function ensureCurrentWeek(db, now) {
  const range = weekRange(0, now)
  const lock = weekLock(db, range.start, now)
  let generationBlocked = null
  db.exec('BEGIN IMMEDIATE')
  try {
    const users = db.prepare("SELECT id FROM users WHERE activo = 1 AND rol_usuario IN ('usuario', 'admin')").all()
    const eligible = new Set(users.map(user => user.id))
    let existing = db.prepare('SELECT assigned_user, replace_user, rol_switched, date, manually_assigned FROM roles WHERE date BETWEEN ? AND ? ORDER BY date').all(range.start, range.end)
    const history = db.prepare('SELECT assigned_user, date FROM roles WHERE date < ? OR date > ? ORDER BY date').all(range.start, range.end)
    const assignedUsers = new Set(existing.map(role => role.assigned_user))
    // A complete week must include every eligible participant when all can fit.
    const missingParticipant = existing.length === 7 && users.length <= 7 && users.some(user => !assignedUsers.has(user.id))
    const invalid = !existing.some(role => role.manually_assigned) && (users.length < minimumWeeklyParticipants || missingParticipant || hasAssignmentViolation(existing, history.filter(role => role.date < range.start), users.length) || existing.some(role =>
      !eligible.has(role.assigned_user) ||
      (role.rol_switched && !eligible.has(role.replace_user))))
    if (!lock && existing.length && invalid) {
      const affected = [...new Set(existing.map(role => role.assigned_user))]
      db.prepare('DELETE FROM roles WHERE date BETWEEN ? AND ?').run(range.start, range.end)
      const restoreLastTurn = db.prepare(`UPDATE users SET ultimo_rol = (SELECT max(date) FROM roles WHERE assigned_user = users.id)
        WHERE id = ? AND ultimo_rol BETWEEN ? AND ?`)
      for (const id of affected) restoreLastTurn.run(id, range.start, range.end)
      existing = []
    }
    if (!existing.length) {
      const assignments = assignmentSchedule(users, range.start, history)
      if (assignments) {
        const insert = db.prepare('INSERT INTO roles (date, assigned_user) VALUES (?, ?)')
        const update = db.prepare('UPDATE users SET ultimo_rol = ? WHERE id = ?')
        for (const [day, id] of assignments.entries()) {
          const date = addDays(range.start, day)
          insert.run(date, id)
          update.run(date, id)
        }
      } else generationBlocked = users.length < minimumWeeklyParticipants ? 'INSUFFICIENT_ACTIVE_USERS' : 'ASSIGNMENT_GAP_UNSATISFIABLE'
    }
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
  return { ...listWeek(db, 0, now), generationBlocked }
}
export function listWeek(db, offset, now) {
  return listWeekStarting(db, weekRange(offset, now).start, now)
}
export function listWeekStarting(db, start, now) {
  const range = { start, end: addDays(start, 6) }
  const roles = db.prepare(`SELECT r.*, a.nombre || ' ' || a.apellido AS assigned_name,
    b.nombre || ' ' || b.apellido AS replacement_name FROM roles r
    JOIN users a ON a.id = r.assigned_user LEFT JOIN users b ON b.id = r.replace_user
    WHERE r.date BETWEEN ? AND ? ORDER BY r.date, r.id`).all(range.start, range.end)
  const participants = db.prepare("SELECT id FROM users WHERE activo = 1 AND rol_usuario IN ('usuario', 'admin')").all()
  const assignments = db.prepare('SELECT assigned_user, date FROM roles ORDER BY date').all()
  return { ...range, roles, monthlyCoverage: monthlyCoverage(participants, assignments, now), lock: start === weekRange(0, now).start ? weekLock(db, start, now) : db.prepare('SELECT * FROM week_locks WHERE week_start = ?').get(start) || null }
}
