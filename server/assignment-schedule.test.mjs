import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assignmentSchedule, monthlyCoverage, hasAssignmentViolation } from './assignment-schedule.mjs'

const users = Array.from({ length: 14 }, (_, i) => ({ id: i + 1 }))
test('everyone without a monthly turn is selected before users already assigned that month', () => {
  const history = users.slice(0, 7).map((user, i) => ({ assigned_user: user.id, date: `2026-11-${String(i + 1).padStart(2, '0')}` }))
  const assignments = assignmentSchedule(users, '2026-11-16', history)
  assert.deepEqual([...assignments].sort((a, b) => a - b), users.slice(7).map(u => u.id))
})
test('weeks crossing a year boundary use the calendar month of each day', () => {
  const history = users.filter(user => ![8, 9, 10, 11].includes(user.id)).map(user => ({ assigned_user: user.id, date: '2026-12-01' }))
  history.push(...users.filter(user => user.id !== 14).map(user => ({ assigned_user: user.id, date: '2027-01-10' })))
  const assignments = assignmentSchedule(users, '2026-12-28', history)
  assert.deepEqual(assignments.slice(0, 4).sort((a, b) => a - b), [8, 9, 10, 11])
  assert.equal(assignments[4], 14)
  assert.equal(new Set(assignments).size, 7)
})
test('monthly counts reset rather than carrying previous-month assignments forward', () => {
  const history = users.slice(0, 7).map(user => ({ assigned_user: user.id, date: '2026-10-31' }))
  history.push(...users.slice(7).map(user => ({ assigned_user: user.id, date: '2026-11-01' })))
  const assignments = assignmentSchedule(users, '2026-11-09', history)
  assert.deepEqual([...assignments].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7])
})
test('when all users have a turn, those with fewer monthly turns take priority', () => {
  const history = users.map(user => ({ assigned_user: user.id, date: '2026-11-01' }))
  history.push(...users.slice(0, 7).map(user => ({ assigned_user: user.id, date: '2026-11-02' })))
  assert.deepEqual(assignmentSchedule(users, '2026-11-16', history).sort((a, b) => a - b), [8, 9, 10, 11, 12, 13, 14])
})
test('coverage reports a capacity shortfall and uses Managua month at UTC midnight', () => {
  const at = new Date('2026-12-01T05:59:59Z')
  const status = monthlyCoverage(users, [{ assigned_user: 1, date: '2026-11-30' }, { assigned_user: 2, date: '2026-12-01' }], at)
  assert.equal(status.month, '2026-11')
  assert.equal(status.remainingDates, 0)
  assert.equal(status.capacityExceeded, true)
  assert.equal(status.missingUserIds.includes(1), false)
  assert.equal(status.missingUserIds.includes(2), true)
})

test('repeat validation depends on the eligible active count but the gap always applies', () => {
  const roles = [
    { assigned_user: 1, date: '2026-11-02' },
    { assigned_user: 2, date: '2026-11-03' },
    { assigned_user: 3, date: '2026-11-04' },
    { assigned_user: 1, date: '2026-11-05' },
  ]
  assert.equal(hasAssignmentViolation(roles, [], 3), false)
  assert.equal(hasAssignmentViolation(roles, [], 6), false)
  assert.equal(hasAssignmentViolation(roles, [], 7), true)
  roles[3].date = '2026-11-04'
  assert.equal(hasAssignmentViolation(roles, [], 3), true)
})
