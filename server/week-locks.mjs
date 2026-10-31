import { weekRange } from './roles.mjs'
export function automaticLock(start, now = new Date()) {
  const deadline = new Date(`${start}T00:00:00-06:00`)
  deadline.setUTCDate(deadline.getUTCDate() + 2)
  return now >= deadline ? deadline.toISOString() : null
}
export function weekLock(db, start, now) {
  const at = automaticLock(start, now)
  if (at) db.prepare("INSERT OR IGNORE INTO week_locks VALUES (?, 'automatic', NULL, 'Sistema', ?)").run(start, at)
  return db.prepare('SELECT * FROM week_locks WHERE week_start = ?').get(start) || null
}
export function lockWeek(db, actorId, now = new Date()) {
  const actor = db.prepare('SELECT rol_usuario, nombre, apellido FROM users WHERE id = ?').get(actorId)
  if (!['admin', 'superadmin'].includes(actor?.rol_usuario)) throw Object.assign(new Error('Solo un administrador puede cerrar la semana'), { status: 403 })
  const { start } = weekRange(0, now)
  weekLock(db, start, now)
  db.prepare("INSERT OR IGNORE INTO week_locks VALUES (?, 'manual', ?, ?, ?)").run(start, actorId, `${actor.nombre} ${actor.apellido}`, now.toISOString())
  return { lock: weekLock(db, start, now) }
}
