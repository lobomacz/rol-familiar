import { randomInt } from 'node:crypto'

export const minimumAssignmentDays = 3
export const minimumWeeklyParticipants = 3
const day = date => Date.parse(`${date}T12:00:00Z`) / 86400000

export function hasAssignmentViolation(roles, history, participantCount = 7) {
  const last = new Map(history.map(role => [role.assigned_user, day(role.date)]))
  const assigned = new Set()
  return roles.some(role => {
    const date = day(role.date), previous = last.get(role.assigned_user)
    const repeated = assigned.has(role.assigned_user)
    assigned.add(role.assigned_user)
    last.set(role.assigned_user, date)
    return (participantCount >= 7 && repeated) || (previous !== undefined && date - previous < minimumAssignmentDays)
  })
}

// Search randomized schedules, retaining history at the week boundary and
// excluding the saved distribution when explicitly reorganizing a week.
export function assignmentSchedule(users, start, history = [], existing = null) {
  if (users.length < minimumWeeklyParticipants) return null
  const first = day(start)
  const last = new Map(history.filter(role => role.date < start).map(role => [role.assigned_user, day(role.date)]))
  const monthCounts = new Map()
  for (const role of history) {
    const key = `${role.date.slice(0, 7)}:${role.assigned_user}`
    monthCounts.set(key, (monthCounts.get(key) || 0) + 1)
  }
  function search(days) {
    if (days.length === 7) {
      if (users.length < 7 && new Set(days).size !== users.length) return null
      return !existing || days.some((id, i) => id !== existing[i]?.assigned_user) ? days : null
    }
    const date = first + days.length
    const pool = users.filter(user => (users.length < 7 || !days.includes(user.id))
      && (!last.has(user.id) || date - last.get(user.id) >= minimumAssignmentDays))
    const month = new Date(date * 86400000).toISOString().slice(0, 7)
    // Shuffle ties, then serve people with the fewest turns in this calendar
    // month. The target week is excluded from history during reorganization.
    const candidates = []
    while (pool.length) candidates.push(...pool.splice(randomInt(pool.length), 1))
    candidates.sort((a, b) => (monthCounts.get(`${month}:${a.id}`) || 0) - (monthCounts.get(`${month}:${b.id}`) || 0))
    for (const user of candidates) {
      const key = `${month}:${user.id}`, count = monthCounts.get(key) || 0
      const previous = last.get(user.id)
      last.set(user.id, date)
      monthCounts.set(key, count + 1)
      const result = search([...days, user.id])
      monthCounts.set(key, count)
      if (previous === undefined) last.delete(user.id); else last.set(user.id, previous)
      if (result) return result
    }
    return null
  }
  return search([])
}

// Coverage is measured by assignment dates in Managua's current month.
export function monthlyCoverage(users, roles, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Managua', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const part = name => parts.find(item => item.type === name).value
  const month = `${part('year')}-${part('month')}`, today = `${month}-${part('day')}`
  const daysInMonth = new Date(Date.UTC(Number(part('year')), Number(part('month')), 0)).getUTCDate()
  const monthly = roles.filter(role => role.date.startsWith(month))
  const assigned = new Set(monthly.map(role => role.assigned_user))
  const missingUserIds = users.filter(user => !assigned.has(user.id)).map(user => user.id)
  const occupied = new Set(monthly.filter(role => role.date >= today).map(role => role.date))
  const remainingDates = daysInMonth - Number(part('day')) + 1 - occupied.size
  return { month, missingUserIds, remainingDates, capacityExceeded: missingUserIds.length > remainingDates }
}
