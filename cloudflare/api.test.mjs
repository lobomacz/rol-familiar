import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './test-helpers.mjs'
import { hashPassword } from '../server/auth.mjs'
import { weekRange } from '../server/roles.mjs'

// Actual workerd + D1, rather than a mocked SQL adapter.
test('Pages API supports authentication, administration, weeks, swaps and append-only notes on D1', async () => {
  const { runtime, db } = await fixture()
  try {
    const password = 'Initial-test-password-482!'
    const hash = await hashPassword(password)
    await db.prepare("INSERT INTO users(id, username, password_hash, nombre, apellido, rol_usuario) VALUES (1, 'admin', ?, 'Superadmin', 'Test', 'superadmin')").bind(hash).run()
    const call = (path, method = 'GET', body, cookie, extraHeaders) => runtime.dispatchFetch(`https://app.example/api${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...extraHeaders }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const json = async (response, status = 200) => { const value = await response.json(); assert.equal(response.status, status, JSON.stringify(value)); return value }
    assert.equal((await call('/health')).status, 200)
    assert.equal((await call('/auth/me')).status, 401)
    assert.equal((await call('/not-a-route')).status, 401)
    const bad = await json(await call('/auth/login', 'POST', { username: 'admin', password: 'wrong' }), 401)
    assert.equal(bad.error, 'Sus datos de acceso no son correctos!')
    const login = async (username, secret) => {
      const response = await call('/auth/login', 'POST', { username, password: secret })
      await json(response)
      assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/)
      assert.match(response.headers.get('set-cookie'), /Secure/)
      return response.headers.get('set-cookie').split(';')[0]
    }
    const admin = await login('admin', password)
    assert.equal((await json(await call('/auth/me', 'GET', undefined, admin))).user.rol_usuario, 'superadmin')
    assert.equal((await call('/users', 'POST', {}, admin, { Origin: 'https://evil.example' })).status, 403)
    assert.equal((await call('/not-a-route', 'GET', undefined, admin)).status, 404)
    const create = async (username, nombre, apellido, rol_usuario = 'usuario') => (await json(await call('/users', 'POST', { username, nombre, apellido, rol_usuario }, admin), 201)).user
    const a = await create('ana', 'Ana', 'Uno')
    const b = await create('bea', 'Bea', 'Dos')
    const c = await create('carlos', 'Carlos', 'Tres', 'admin')
    const temporary = await login('ana', 'anauno')
    assert.equal((await call('/roles/ensure-current', 'POST', undefined, temporary)).status, 403)
    const newPassword = 'StrongPass1!'
    await json(await call('/auth/password', 'POST', { currentPassword: 'anauno', newPassword, confirmPassword: newPassword }, temporary))
    const ana = await login('ana', newPassword)
    assert.equal((await call('/users', 'GET', undefined, ana)).status, 403)
    const weeks = await Promise.all(Array.from({ length: 3 }, () => call('/roles/ensure-current', 'POST', undefined, admin)))
    const data = await Promise.all(weeks.map(response => json(response)))
    for (const week of data) { assert.equal(week.roles.length, 7); assert.deepEqual(week.roles, data[0].roles) }
    const roles = data[0].roles
    assert.equal(roles[0].date, weekRange().start)
    assert.equal(new Date(`${roles[6].date}T12:00:00Z`).getUTCDay(), 0)
    assert.equal(roles.some(role => role.assigned_user === 1), false)
    const own = roles.find(role => role.assigned_user === a.id)
    const options = await json(await call(`/roles/${own.id}/replacements`, 'GET', undefined, admin))
    const replacement = options.users.find(user => user.days.length)
    assert.ok(replacement)
    const competing = await Promise.all(Array.from({ length: 2 }, () => call(`/roles/${own.id}/switch`, 'PATCH', { rol_switched: true, replace_user: replacement.id, replace_role_id: replacement.days[0].id }, admin)))
    assert.deepEqual(competing.map(response => response.status).sort(), [200, 409])
    const switched = await json(competing.find(response => response.status === 200))
    assert.equal(switched.roles.find(role => role.id === own.id).replace_user, replacement.id)
    assert.equal(switched.roles.find(role => role.id === replacement.days[0].id).replace_user, a.id)
    await json(await call(`/roles/${own.id}/switch`, 'PATCH', { rol_switched: false, expected_replace_user: replacement.id }, admin))
    const note = await json(await call('/notes', 'POST', { date: own.date, text: 'Primera entrada', priority: 'normal' }, ana), 201)
    await json(await call(`/notes/${note.id}/entries`, 'POST', { text: 'Segunda entrada' }, ana))
    const notes = await json(await call('/notes', 'GET', undefined, ana))
    assert.equal(notes.notes.find(row => row.id === note.id).entries.length, 2)
    await json(await call(`/notes/${note.id}/complete`, 'POST', undefined, admin))
    assert.equal((await call(`/notes/${note.id}/entries`, 'POST', { text: 'No permitida' }, ana)).status, 409)
    await json(await call('/notes', 'POST', { date: own.date, text: 'Derivada', parent_id: note.id }, ana), 201)
    // The deployed Pages route must support the same reassignment flow as Node.
    const assignmentPath = `/roles/${own.id}/assignment`
    const update = { assigned_user: replacement.id, expected_assigned_user: a.id, expected_replace_user: null }
    assert.equal((await call(assignmentPath, 'PATCH', update, ana)).status, 403)
    assert.equal((await call('/roles/999999/assignment', 'PATCH', update, admin)).status, 404)
    for (const assigned_user of [1, 999999, '2', null]) {
      assert.equal((await call(assignmentPath, 'PATCH', { assigned_user }, admin)).status, 400)
    }
    await json(await call(`/roles/${own.id}/switch`, 'PATCH', { rol_switched: true, replace_user: replacement.id, replace_role_id: replacement.days[0].id }, ana))
    assert.equal((await call(assignmentPath, 'PATCH', update, admin)).status, 409)
    const reassigned = await json(await call(assignmentPath, 'PATCH', { ...update, expected_replace_user: replacement.id }, admin))
    const changed = reassigned.roles.find(role => role.id === own.id)
    assert.equal(changed.assigned_user, replacement.id)
    assert.equal(changed.manually_assigned, 1)
    assert.equal(changed.replace_user, null)
    assert.equal(reassigned.roles.find(role => role.id === replacement.days[0].id).replace_user, null)
    const refreshed = await json(await call('/roles/ensure-current', 'POST', undefined, admin))
    assert.deepEqual(refreshed.roles, reassigned.roles)
    const previousDate = weekRange(-1).start
    await db.prepare('INSERT INTO roles(date, assigned_user) VALUES (?, ?)').bind(previousDate, a.id).run()
    const previousRole = await db.prepare('SELECT id FROM roles WHERE date = ?').bind(previousDate).first()
    assert.equal((await call(`/roles/${previousRole.id}/assignment`, 'PATCH', update, admin)).status, 403)
    // Every current day is editable by superadmin, including elapsed days.
    for (const role of refreshed.roles) {
      const target = [a.id, b.id, c.id].find(id => id !== role.assigned_user)
      const result = await json(await call(`/roles/${role.id}/assignment`, 'PATCH', { assigned_user: target }, admin))
      assert.equal(result.roles.find(row => row.id === role.id).assigned_user, target)
    }
    const beforeReorganization = await json(await call('/roles', 'GET', undefined, admin))
    assert.equal((await call('/roles/reorganize', 'POST', undefined, ana)).status, 403)
    const reorganized = await json(await call('/roles/reorganize', 'POST', undefined, admin))
    assert.notDeepEqual(reorganized.roles.map(role => role.assigned_user), beforeReorganization.roles.map(role => role.assigned_user))
    assert.deepEqual(reorganized.roles.map(role => role.id), beforeReorganization.roles.map(role => role.id))
    for (let index = 0; index < 7; index++) {
      const role = reorganized.roles[index]
      assert.equal(role.manually_assigned, 0)
      assert.equal(role.replace_user, null)
      if (index) assert.notEqual(role.assigned_user, reorganized.roles[index - 1].assigned_user)
    }
    assert.deepEqual((await json(await call('/roles/ensure-current', 'POST', undefined, admin))).roles, reorganized.roles)
    assert.equal((await db.prepare('SELECT count(*) AS count FROM notes').first()).count, 2)
    assert.equal((await db.prepare('SELECT assigned_user FROM roles WHERE id = ?').bind(previousRole.id).first()).assigned_user, a.id)
    await json(await call(`/users/${c.id}/role`, 'PATCH', { rol_usuario: 'usuario' }, admin))
    await json(await call(`/users/${b.id}/active`, 'PATCH', { activo: false }, admin))
    assert.equal((await call('/auth/login', 'POST', { username: 'bea', password: 'beados' })).status, 401)
    await json(await call(`/users/${a.id}/reset-password`, 'POST', undefined, admin))
    assert.equal((await call('/auth/me', 'GET', undefined, ana)).status, 401)
    await json(await call('/auth/logout', 'POST', undefined, admin))
    assert.equal((await call('/auth/me', 'GET', undefined, admin)).status, 401)
    for (let index = 0; index < 11; index++) {
      const response = await call('/auth/login', 'POST', { username: 'nobody', password: 'wrong' }, undefined, { 'CF-Connecting-IP': '203.0.113.9' })
      assert.equal(response.status, index < 10 ? 401 : 429)
    }
    assert.equal((await db.prepare('SELECT max(count) AS count FROM auth_attempts').first()).count, 11)
    assert.equal((await db.prepare('SELECT count(*) AS count FROM write_guards').first()).count, 0)
    assert.equal((await db.prepare('PRAGMA foreign_key_check').all()).results.length, 0)
  } finally { await runtime.dispose() }
})
