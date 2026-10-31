import { openDatabase } from '../server/database.mjs'
import { ensureCurrentWeek, weekRange } from '../server/roles.mjs'

const db = openDatabase()
try {
  const now = new Date()
  const range = weekRange(0, now)
  const before = db.prepare('SELECT count(*) AS count FROM roles WHERE date BETWEEN ? AND ?').get(range.start, range.end).count
  const eligibleUsers = db.prepare("SELECT count(*) AS count FROM users WHERE activo = 1 AND rol_usuario IN ('usuario', 'admin')").get().count
  const result = ensureCurrentWeek(db, now)
  console.log(JSON.stringify({ ...range, eligibleUsers, entriesBefore: before, entriesAfter: result.roles.length, generationBlocked: result.generationBlocked }))
} finally { db.close() }
