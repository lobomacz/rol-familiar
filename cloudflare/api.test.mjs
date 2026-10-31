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
    const newPassword = 'StrongPass26!@#$'
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
    const options = await json(await call(`/roles/${own.id}/replacements`, 'GET', undefined, ana))
    const replacement = options.users.find(user => user.days.length)
    assert.ok(replacement)
    const competing = await Promise.all(Array.from({ length: 2 }, () => call(`/roles/${own.id}/switch`, 'PATCH', { rol_switched: true, replace_user: replacement.id, replace_role_id: replacement.days[0].id }, ana)))
    assert.deepEqual(competing.map(response => response.status).sort(), [200, 409])
    const switched = await json(competing.find(response => response.status === 200))
    assert.equal(switched.roles.find(role => role.id === own.id).replace_user, replacement.id)
    await json(await call(`/roles/${own.id}/switch`, 'PATCH', { rol_switched: false, expected_replace_user: replacement.id }, ana))
    const note = await json(await call('/notes', 'POST', { date: own.date, text: 'Primera entrada', priority: 'normal' }, ana), 201)
    await json(await call(`/notes/${note.id}/entries`, 'POST', { text: 'Segunda entrada' }, ana))
    const notes = await json(await call('/notes', 'GET', undefined, ana))
    assert.equal(notes.notes.find(row => row.id === note.id).entries.length, 2)
    await json(await call(`/notes/${note.id}/complete`, 'POST', undefined, admin))
    assert.equal((await call(`/notes/${note.id}/entries`, 'POST', { text: 'No permitida' }, ana)).status, 409)
    await json(await call('/notes', 'POST', { date: own.date, text: 'Derivada', parent_id: note.id }, ana), 201)
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
