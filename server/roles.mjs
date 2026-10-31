import { randomInt } from 'node:crypto'

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
  let generationBlocked = null
  db.exec('BEGIN IMMEDIATE')
  try {
    const users = db.prepare("SELECT id FROM users WHERE activo = 1 AND rol_usuario IN ('usuario', 'admin')").all()
    const eligible = new Set(users.map(user => user.id))
    let existing = db.prepare('SELECT assigned_user, replace_user, rol_switched, date FROM roles WHERE date BETWEEN ? AND ? ORDER BY date').all(range.start, range.end)
    const previousUser = db.prepare('SELECT assigned_user FROM roles WHERE date = ?').get(addDays(range.start, -1))?.assigned_user
    const assignedUsers = new Set(existing.map(role => role.assigned_user))
    // A complete week must include every eligible participant when all can fit.
    const missingParticipant = existing.length === 7 && users.length <= 7 && users.some(user => !assignedUsers.has(user.id))
    const invalid = users.length < 2 || missingParticipant || existing.some((role, index) =>
      !eligible.has(role.assigned_user) ||
      (role.rol_switched && !eligible.has(role.replace_user)) ||
      role.assigned_user === (index ? existing[index - 1].assigned_user : previousUser))
    if (existing.length && invalid) {
      const affected = [...new Set(existing.map(role => role.assigned_user))]
      db.prepare('DELETE FROM roles WHERE date BETWEEN ? AND ?').run(range.start, range.end)
      const restoreLastTurn = db.prepare(`UPDATE users SET ultimo_rol = (SELECT max(date) FROM roles WHERE assigned_user = users.id)
        WHERE id = ? AND ultimo_rol BETWEEN ? AND ?`)
      for (const id of affected) restoreLastTurn.run(id, range.start, range.end)
      existing = []
    }
    if (!existing.length) {
      if (users.length >= 2) {
        const insert = db.prepare('INSERT INTO roles (date, assigned_user) VALUES (?, ?)')
        const update = db.prepare('UPDATE users SET ultimo_rol = ? WHERE id = ?')
        const turns = new Map(users.map(user => [user.id, 0]))
        let lastAssignedUser = previousUser
        for (let day = 0; day < 7; day++) {
          const candidates = users.filter(user => user.id !== lastAssignedUser)
          const fewestTurns = Math.min(...candidates.map(user => turns.get(user.id)))
          const nextUsers = candidates.filter(user => turns.get(user.id) === fewestTurns)
          const user = nextUsers[randomInt(nextUsers.length)]
          turns.set(user.id, turns.get(user.id) + 1)
          const date = addDays(range.start, day)
          insert.run(date, user.id)
          update.run(date, user.id)
          lastAssignedUser = user.id
        }
      } else generationBlocked = 'INSUFFICIENT_ACTIVE_USERS'
    }
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
  return { ...listWeek(db, 0, now), generationBlocked }
}
export function listWeek(db, offset, now) {
  return listWeekStarting(db, weekRange(offset, now).start)
}
export function listWeekStarting(db, start) {
  const range = { start, end: addDays(start, 6) }
  const roles = db.prepare(`SELECT r.*, a.nombre || ' ' || a.apellido AS assigned_name,
    b.nombre || ' ' || b.apellido AS replacement_name FROM roles r
    JOIN users a ON a.id = r.assigned_user LEFT JOIN users b ON b.id = r.replace_user
    WHERE r.date BETWEEN ? AND ? ORDER BY r.date, r.id`).all(range.start, range.end)
  return { ...range, roles }
}
