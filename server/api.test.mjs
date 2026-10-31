import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { DatabaseSync } from 'node:sqlite'
import { hashPassword, verifyPassword } from './auth.mjs'

test('SQLite authentication, session lifecycle and member persistence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rol-familiar-test-'))
  let child
  const base = 'http://127.0.0.1:19374'
  async function start() {
    child = spawn(process.execPath, ['server/index.mjs'], {
      env: { ...process.env, API_PORT: '19374', SQLITE_PATH: join(directory, 'test.sqlite') },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('API startup timed out')), 10000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`API exited: ${code}`)) })
      child.stdout.once('data', () => { clearTimeout(timer); resolve() })
    })
  }
  async function stop() {
    if (!child || child.exitCode !== null) return
    const exited = once(child, 'exit')
    child.kill('SIGTERM')
    await exited
  }
  try {
    const db = new DatabaseSync(join(directory, 'test.sqlite'))
    db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL)')
    const password = 'Test-only password 782!'
    const passwordHash = await hashPassword(password)
    assert.notEqual(passwordHash, password)
    assert.notEqual(passwordHash, await hashPassword(password))
    assert.equal(await verifyPassword(password, passwordHash), true)
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('tester', passwordHash)
    db.close()
    await start()
    assert.equal((await fetch(`${base}/api/auth/me`)).status, 401)
    assert.equal((await fetch(`${base}/api/members`)).status, 401)
    const login = (username, password) => fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
    })
    for (const [username, secret] of [['tester', 'wrong'], ["' OR 1=1 --", password]]) {
      const rejected = await login(username, secret)
      assert.equal(rejected.status, 401)
      assert.equal((await rejected.json()).error, 'Sus datos de acceso no son correctos!')
    }
    const authenticated = await login('TESTER', password)
    assert.equal(authenticated.status, 200)
    const setCookie = authenticated.headers.get('set-cookie')
    assert.match(setCookie, /HttpOnly/)
    assert.match(setCookie, /SameSite=Strict/)
    const cookie = setCookie.split(';')[0]
    const profile = (await authenticated.json()).user
    assert.equal(profile.username, 'tester')
    assert.equal(profile.nombre, 'tester')
    assert.equal(profile.rol_usuario, 'usuario')
    assert.equal(profile.password_hash, undefined)
    const me = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } })
    assert.equal(me.status, 200)
    const crossOrigin = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie, Origin: 'http://attacker.invalid' } })
    assert.equal(crossOrigin.status, 403)
    assert.equal((await fetch(`${base}/api/health`)).status, 200)
    const post = name => fetch(`${base}/api/members`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ name }),
    })
    assert.equal((await post('   ')).status, 400)
    assert.equal((await post('x'.repeat(101))).status, 400)
    const saved = await post('  Alex  ')
    assert.equal(saved.status, 201)
    assert.equal((await saved.json()).name, 'Alex')
    await stop()
    await start()
    assert.deepEqual(await (await fetch(`${base}/api/members`, { headers: { Cookie: cookie } })).json(), [{ id: 1, name: 'Alex' }])
    const createUser = (body, authCookie = cookie) => fetch(`${base}/api/users`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: authCookie }, body: JSON.stringify(body) })
    const candidate = { username: 'new-user', nombre: 'Nueva', apellido: 'Persona', rol_usuario: 'usuario' }
    assert.equal((await createUser(candidate)).status, 403)
    assert.equal((await fetch(`${base}/api/users/1/reset-password`, { method: 'POST', headers: { Cookie: cookie } })).status, 403)
    assert.equal((await fetch(`${base}/api/users`, { headers: { Cookie: cookie } })).status, 403)
    assert.equal((await fetch(`${base}/api/users/1/active`, { method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ activo: false }) })).status, 403)
    assert.equal((await fetch(`${base}/api/roles/history`, { headers: { Cookie: cookie } })).status, 200)
    const adminDb = new DatabaseSync(join(directory, 'test.sqlite'))
    const identityIndex = adminDb.prepare('PRAGMA index_list(users)').all().find(index => index.name === 'users_nombre_apellido_username_unique')
    assert.equal(identityIndex.unique, 1)
    const identityColumns = adminDb.prepare('PRAGMA index_xinfo(users_nombre_apellido_username_unique)').all().filter(column => column.key)
    assert.deepEqual(identityColumns.map(column => column.name), ['nombre', 'apellido', 'username'])
    assert.ok(identityColumns.every(column => column.coll === 'NOCASE'))
    adminDb.prepare("UPDATE users SET rol_usuario = 'admin' WHERE username = 'tester'").run()
    assert.equal((await createUser({ ...candidate, rol_usuario: 'superadmin' })).status, 400)
    assert.equal((await createUser({ ...candidate, nombre: ' ' })).status, 400)
    assert.equal((await createUser({ ...candidate, ultimo_rol: '2026-02-30' })).status, 400)
    const createdResponse = await createUser(candidate)
    assert.equal(createdResponse.status, 201)
    const created = (await createdResponse.json()).user
    assert.equal(created.activo, true)
    assert.equal(created.ultimo_rol, null)
    assert.equal(created.password_hash, undefined)
    assert.equal((await createUser(candidate)).status, 409)
    assert.equal((await createUser({ ...candidate, nombre: 'NUEVA', apellido: 'PERSONA', username: 'NEW-USER' })).status, 409)
    assert.ok(created.password_reset_at)
    const temporaryLogin = await login('new-user', 'nuevapersona')
    assert.equal(temporaryLogin.status, 200)
    assert.ok((await temporaryLogin.json()).user.password_reset_at)
    const temporaryCookie = temporaryLogin.headers.get('set-cookie').split(';')[0]
    assert.equal((await fetch(`${base}/api/roles/history`, { headers: { Cookie: temporaryCookie } })).status, 403)
    const stored = adminDb.prepare('SELECT * FROM users WHERE id = ?').get(created.id)
    assert.notEqual(stored.password_hash, password)
    assert.equal(await verifyPassword('nuevapersona', stored.password_hash), true)
    const newUserPassword = 'UserSecret1!'
    const userPasswordChange = body => fetch(`${base}/api/auth/password`, { method: 'POST', headers: { Cookie: temporaryCookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    assert.equal((await userPasswordChange({ currentPassword: 'nuevapersona', newPassword: 'weak', confirmPassword: 'weak' })).status, 400)
    assert.ok(adminDb.prepare('SELECT password_reset_at FROM users WHERE id = ?').get(created.id).password_reset_at)
    assert.equal((await userPasswordChange({ currentPassword: 'nuevapersona', newPassword: newUserPassword, confirmPassword: newUserPassword })).status, 200)
    assert.equal(adminDb.prepare('SELECT password_reset_at FROM users WHERE id = ?').get(created.id).password_reset_at, null)
    assert.equal((await fetch(`${base}/api/roles/history`, { headers: { Cookie: temporaryCookie } })).status, 200)
    adminDb.prepare("UPDATE users SET rol_usuario = 'superadmin' WHERE username = 'tester'").run()
    assert.equal((await createUser({ ...candidate, username: 'super-user', rol_usuario: 'superadmin' })).status, 400)
    assert.equal(adminDb.prepare("SELECT count(*) AS count FROM users WHERE username = 'super-user'").get().count, 0)
    assert.equal((await createUser({ ...candidate, username: 'new-admin', rol_usuario: 'admin' })).status, 201)
    assert.equal((await createUser({ ...candidate, username: 'inactive', activo: false })).status, 201)
    assert.equal((await login('inactive', 'nuevapersona')).status, 401)
    const ensureWeek = () => fetch(`${base}/api/roles/ensure-current`, { method: 'POST', headers: { Cookie: cookie } })
    const weekly = await (await ensureWeek()).json()
    assert.equal(weekly.roles.length, 7)
    assert.equal(new Date(weekly.start + 'T12:00:00Z').getUTCDay(), 1)
    assert.equal(new Date(weekly.end + 'T12:00:00Z').getUTCDay(), 0)
    assert.equal(weekly.roles[6].date, weekly.end)
    assert.equal(weekly.roles.some(role => [1, 4].includes(role.assigned_user)), false)
    assert.ok(weekly.roles.every((role, index) => role.assigned_user && (!index || role.assigned_user !== weekly.roles[index - 1].assigned_user)))
    const repeated = await Promise.all([ensureWeek(), ensureWeek(), ensureWeek()])
    for (const response of repeated) assert.deepEqual((await response.json()).roles, weekly.roles)
    const ownRole = weekly.roles.find(role => role.assigned_user === created.id)
    const otherRole = weekly.roles.find(role => role.assigned_user !== created.id)
    const regularLogin = await login('new-user', newUserPassword)
    const regularCookie = regularLogin.headers.get('set-cookie').split(';')[0]
    const switchRole = (id, body, authCookie = regularCookie) => fetch(`${base}/api/roles/${id}/switch`, { method: 'PATCH', headers: { Cookie: authCookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    assert.equal((await switchRole(otherRole.id, { rol_switched: true, replace_user: created.id })).status, 403)
    assert.equal((await switchRole(ownRole.id, { rol_switched: true, replace_user: otherRole.assigned_user }, cookie)).status, 400)
    const options = await fetch(`${base}/api/roles/${ownRole.id}/replacements`, { headers: { Cookie: regularCookie } })
    assert.equal(options.status, 200)
    assert.deepEqual((await options.json()).users.map(user => user.id), [otherRole.assigned_user])
    const swapped = await switchRole(ownRole.id, { rol_switched: true, replace_user: otherRole.assigned_user, replace_role_id: otherRole.id }, cookie)
    assert.equal(swapped.status, 200)
    const swappedWeek = await swapped.json()
    assert.equal(swappedWeek.roles.find(role => role.id === ownRole.id).replace_user, otherRole.assigned_user)
    assert.equal(swappedWeek.roles.find(role => role.id === otherRole.id).replace_user, created.id)
    assert.ok(swappedWeek.roles.filter(role => role.id !== otherRole.id && role.id !== ownRole.id).every(role => role.replace_user === null && role.rol_switched === 0))
    assert.equal((await switchRole(ownRole.id, { rol_switched: false })).status, 200)
    const selected = await fetch(`${base}/api/roles?start=${weekly.start}`, { headers: { Cookie: regularCookie } })
    assert.equal(selected.status, 200)
    assert.equal((await selected.json()).isCurrentWeek, true)
    const countBeforeRead = adminDb.prepare('SELECT count(*) AS count FROM roles').get().count
    for (const start of ['2020-01-06', '2020-01-13']) {
      const historical = await fetch(`${base}/api/roles?start=${start}`, { headers: { Cookie: regularCookie } })
      assert.equal(historical.status, 200)
      const historicalWeek = await historical.json()
      assert.equal(historicalWeek.isCurrentWeek, false)
      assert.deepEqual(historicalWeek.roles, [])
    }
    for (const start of ['2026-02-30', '2026-10-27', 'invalid']) assert.equal((await fetch(`${base}/api/roles?start=${start}`, { headers: { Cookie: regularCookie } })).status, 400)
    assert.equal(adminDb.prepare('SELECT count(*) AS count FROM roles').get().count, countBeforeRead)
    adminDb.prepare('DELETE FROM roles WHERE id = ?').run(weekly.roles[0].id)
    assert.equal((await (await ensureWeek()).json()).roles.length, 6)
    const previous = await fetch(`${base}/api/roles?week=previous`, { headers: { Cookie: cookie } })
    assert.deepEqual((await previous.json()).roles, [])
    assert.equal(adminDb.prepare('SELECT count(*) AS count FROM roles').get().count, 6)
    assert.throws(() => adminDb.prepare("UPDATE users SET rol_usuario = 'invalid' WHERE id = 1").run())
    assert.equal(adminDb.prepare("SELECT ultimo_rol FROM users WHERE username = 'tester'").get().ultimo_rol, null)
    const history = await (await fetch(`${base}/api/roles/history`, { headers: { Cookie: cookie } })).json()
    assert.equal(history.roles.length, 6)
    assert.equal(typeof history.roles[0].assigned_name, 'string')
    const protectedAdmin = adminDb.prepare("INSERT INTO users (username, password_hash, nombre, apellido, rol_usuario) VALUES ('admin', ?, 'Initial', 'Admin', 'superadmin')").run(passwordHash)
    for (const role of ['usuario', 'admin']) {
      for (const active of [0, null]) {
        adminDb.prepare("UPDATE users SET activo = ?, rol_usuario = ? WHERE username = 'inactive'").run(active, role)
        assert.equal((await login('inactive', 'nuevapersona')).status, 401)
      }
      adminDb.prepare("UPDATE users SET activo = 1 WHERE username = 'inactive'").run()
      const activeLogin = await login('inactive', 'nuevapersona')
      assert.equal(activeLogin.status, 200)
      const activeCookie = activeLogin.headers.get('set-cookie').split(';')[0]
      assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: activeCookie } })).status, 200)
      adminDb.prepare("UPDATE users SET activo = 0 WHERE username = 'inactive'").run()
      assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: activeCookie } })).status, 401)
    }
    for (const active of [0, null]) {
      adminDb.prepare("UPDATE users SET activo = ? WHERE username = 'admin'").run(active)
      const superLogin = await login('admin', password)
      assert.equal(superLogin.status, 200)
      const superCookie = superLogin.headers.get('set-cookie').split(';')[0]
      assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: superCookie } })).status, 200)
    }
    assert.equal((await login('admin', 'incorrect')).status, 401)
    const listedUsers = await (await fetch(`${base}/api/users`, { headers: { Cookie: cookie } })).json()
    assert.equal(listedUsers.users.some(user => user.username.toLowerCase() === 'admin'), false)
    assert.equal(listedUsers.users.some(user => user.password_hash !== undefined), false)
    assert.equal(listedUsers.users.find(user => user.id === created.id).rol_usuario, 'usuario')
    const activity = (id, activo) => fetch(`${base}/api/users/${id}/active`, { method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ activo }) })
    assert.equal((await activity(protectedAdmin.lastInsertRowid, false)).status, 403)
    assert.equal((await activity(created.id, 'false')).status, 400)
    assert.equal((await activity(99999, false)).status, 404)
    assert.equal((await activity(created.id, false)).status, 200)
    assert.equal(adminDb.prepare('SELECT activo FROM users WHERE id = ?').get(created.id).activo, 0)
    assert.equal((await login('new-user', newUserPassword)).status, 401)
    assert.equal((await activity(created.id, true)).status, 200)
    assert.equal((await login('new-user', newUserPassword)).status, 200)
    adminDb.prepare("UPDATE users SET rol_usuario = 'admin' WHERE username = 'tester'").run()
    assert.equal((await activity(created.id, false)).status, 403)
    assert.equal(adminDb.prepare('SELECT activo FROM users WHERE id = ?').get(created.id).activo, 1)
    assert.equal((await fetch(`${base}/api/users`, { headers: { Cookie: cookie } })).status, 200)
    const resetPassword = id => fetch(`${base}/api/users/${id}/reset-password`, { method: 'POST', headers: { Cookie: cookie } })
    assert.equal((await resetPassword(protectedAdmin.lastInsertRowid)).status, 403)
    assert.equal((await resetPassword(99999)).status, 404)
    adminDb.prepare("UPDATE users SET rol_usuario = 'superadmin' WHERE username = 'tester'").run()
    assert.equal((await activity(created.id, true)).status, 200)
    adminDb.prepare("UPDATE users SET rol_usuario = 'admin' WHERE username = 'tester'").run()
    const beforeReset = await login('new-user', newUserPassword)
    const beforeResetCookie = beforeReset.headers.get('set-cookie').split(';')[0]
    const resetResponse = await resetPassword(created.id)
    assert.equal(resetResponse.status, 200)
    assert.ok((await resetResponse.json()).password_reset_at)
    assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: beforeResetCookie } })).status, 401)
    assert.equal((await login('new-user', newUserPassword)).status, 401)
    const resetLogin = await login('new-user', 'nuevapersona')
    assert.equal(resetLogin.status, 200)
    const resetCookie = resetLogin.headers.get('set-cookie').split(';')[0]
    assert.ok((await resetLogin.json()).user.password_reset_at)
    await stop()
    await start()
    assert.ok((await (await fetch(`${base}/api/auth/me`, { headers: { Cookie: resetCookie } })).json()).user.password_reset_at)
    assert.equal((await fetch(`${base}/api/roles/history`, { headers: { Cookie: resetCookie } })).status, 403)
    assert.equal((await fetch(`${base}/api/users`, { headers: { Cookie: resetCookie } })).status, 403)
    assert.equal((await fetch(`${base}/api/auth/password`, { method: 'POST', headers: { Cookie: resetCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: 'nuevapersona', newPassword: newUserPassword, confirmPassword: newUserPassword }) })).status, 200)
    assert.equal((await fetch(`${base}/api/roles/history`, { headers: { Cookie: resetCookie } })).status, 200)
    assert.equal(adminDb.prepare('SELECT password_reset_at FROM users WHERE id = ?').get(created.id).password_reset_at, null)
    adminDb.close()
    const newPassword = 'StrongPass1!'
    const otherLogin = await login('tester', password)
    const otherCookie = otherLogin.headers.get('set-cookie').split(';')[0]
    const changePassword = body => fetch(`${base}/api/auth/password`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const passwordChange = { currentPassword: password, newPassword, confirmPassword: newPassword }
    for (const weak of ['shortA1!', 'abcdefghijklmnop', 'ABCDEFGHIJKLMNOP', 'Abcdefghijklmno!', 'Abcdefghijklmn12', 'Abcdefghijklm12!x']) {
      assert.equal((await changePassword({ ...passwordChange, newPassword: weak, confirmPassword: weak })).status, 400)
    }
    assert.equal((await changePassword({ ...passwordChange, currentPassword: 'incorrect' })).status, 400)
    assert.equal((await changePassword({ ...passwordChange, confirmPassword: 'mismatch' })).status, 400)
    assert.equal((await changePassword(passwordChange)).status, 200)
    assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } })).status, 200)
    assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: otherCookie } })).status, 401)
    assert.equal((await login('tester', password)).status, 401)
    const logout = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie } })
    assert.equal(logout.status, 200)
    assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } })).status, 401)
    const second = await login('tester', newPassword)
    const secondCookie = second.headers.get('set-cookie').split(';')[0]
    const expiredDb = new DatabaseSync(join(directory, 'test.sqlite'))
    expiredDb.prepare('UPDATE sessions SET expires_at = 0').run()
    expiredDb.close()
    assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: secondCookie } })).status, 401)
  } finally {
    await stop()
    await rm(directory, { recursive: true, force: true })
  }
})
