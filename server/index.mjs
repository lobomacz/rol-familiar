import { changeUserRole } from './user-roles.mjs'
import { listNotes, createNote, appendNote, completeNote, clearPendingNotes } from './notes.mjs'
import { genericPasswordCredentials } from './password-reset.mjs'
import { isStrongPassword } from '../src/helpers/password-policy.js'
import { createServer } from 'node:http'
import { replacementOptions, switchAssignment } from './role-swaps.mjs'
import { ensureCurrentWeek, listWeek, listWeekStarting, weekRange } from './roles.mjs'
import { openDatabase } from './database.mjs'
import { hashPassword, verifyPassword, tokenHash, newToken } from './auth.mjs'

const db = openDatabase()
const dummyHash = await hashPassword(newToken())
const failureMessage = 'Sus datos de acceso no son correctos!'
const failures = new Map()
const sessionDuration = 8 * 60 * 60 * 1000
const secureCookie = process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''
const cookie = (token, age) => `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secureCookie}`
async function readBody(req) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (Buffer.byteLength(body) > 8192) throw Object.assign(new Error('Solicitud demasiado grande'), { status: 413 })
  }
  try { return JSON.parse(body) } catch { throw Object.assign(new Error('JSON inválido'), { status: 400 }) }
}
const list = db.prepare('SELECT id, name FROM members ORDER BY id')
const insert = db.prepare('INSERT INTO members (name) VALUES (?)')

const server = createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(body))
  }
  try {
    if (req.method === 'GET' && req.url === '/api/health') {
      db.prepare('SELECT 1').get()
      return send(200, { status: 'ok', database: 'sqlite' })
    }
    // Reject cross-origin writes; the browser uses the same-origin Vite proxy.
    if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin) {
      let origin
      try { origin = new URL(req.headers.origin).host } catch { return send(403, { error: 'Origen no permitido' }) }
      if (origin !== req.headers.host) return send(403, { error: 'Origen no permitido' })
    }
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now())
    const token = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('session='))?.slice(8) || ''
    const session = db.prepare(`SELECT users.id, users.username, users.nombre, users.apellido, users.ultimo_rol, users.activo, users.rol_usuario, users.password_reset_at FROM sessions JOIN users ON users.id = sessions.user_id WHERE token_hash = ? AND expires_at > ? AND (users.rol_usuario = 'superadmin' OR users.activo = 1)`).get(tokenHash(token), Date.now())
    if (req.method === 'POST' && req.url === '/api/auth/login') {
      const key = req.socket.remoteAddress
      const now = Date.now()
      for (const [ip, entry] of failures) if (entry.until <= now) failures.delete(ip)
      const attempt = failures.get(key)
      if (attempt?.count >= 10) return send(429, { error: failureMessage })
      const data = await readBody(req)
      const username = typeof data?.username === 'string' ? data.username.trim() : ''
      const password = typeof data?.password === 'string' ? data.password : ''
      if (username.length > 100 || !password || password.length > 1024) return send(401, { error: failureMessage })
      const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username)
      const valid = await verifyPassword(password, user?.password_hash || dummyHash)
      if (!user || !valid || (user.rol_usuario !== 'superadmin' && user.activo !== 1)) {
        failures.set(key, { count: (attempt?.count || 0) + 1, until: attempt?.until || now + 15 * 60 * 1000 })
        return send(401, { error: failureMessage })
      }
      failures.delete(key)
      if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token))
      const nextToken = newToken()
      db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash(nextToken), user.id, now + sessionDuration)
      res.setHeader('Set-Cookie', cookie(nextToken, sessionDuration / 1000))
      const { password_hash, ...profile } = user
      return send(200, { user: profile })
    }
    if (req.method === 'POST' && req.url === '/api/auth/logout') {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token))
      res.setHeader('Set-Cookie', cookie('', 0))
      return send(200, { ok: true })
    }
    if (!session) return send(401, { error: 'Debe iniciar sesión' })
    if (req.method === 'GET' && req.url === '/api/auth/me') return send(200, { user: session })
    const url = new URL(req.url, 'http://localhost')
    if (req.method === 'POST' && url.pathname === '/api/auth/password') {
      const key = `password:${session.id}`
      const attempt = failures.get(key)
      if (attempt?.until > Date.now() && attempt.count >= 10) return send(429, { error: 'Demasiados intentos. Intente de nuevo en 15 minutos.' })
      const data = await readBody(req)
      if (typeof data?.currentPassword !== 'string' || !data.currentPassword || data.currentPassword.length > 1024)
        return send(400, { error: 'Ingrese su contraseña actual' })
      if (!isStrongPassword(data?.newPassword)) return send(400, { error: 'La nueva contraseña debe tener exactamente 16 caracteres e incluir minúsculas, mayúsculas, números y símbolos.' })
      if (data.newPassword === data.currentPassword) return send(400, { error: 'La nueva contraseña debe ser diferente de la actual' })
      if (data.confirmPassword !== data.newPassword) return send(400, { error: 'Las contraseñas no coinciden' })
      const account = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(session.id)
      if (!await verifyPassword(data.currentPassword, account.password_hash)) {
        failures.set(key, { count: attempt?.until > Date.now() ? attempt.count + 1 : 1, until: attempt?.until > Date.now() ? attempt.until : Date.now() + 15 * 60 * 1000 })
        return send(400, { error: 'La contraseña actual no es correcta' })
      }
      const hash = await hashPassword(data.newPassword)
      const updated = db.prepare('UPDATE users SET password_hash = ?, password_reset_at = NULL WHERE id = ? AND password_hash = ?').run(hash, session.id, account.password_hash)
      if (!updated.changes) return send(409, { error: 'La contraseña ha cambiado. Intente de nuevo.' })
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(session.id, tokenHash(token))
      failures.delete(key)
      return send(200, { ok: true })
    }
    if (session.password_reset_at) return send(403, { error: 'Debe cambiar su contraseña antes de continuar', code: 'PASSWORD_CHANGE_REQUIRED' })
    const canManageUsers = ['admin', 'superadmin'].includes(session.rol_usuario)
    if (url.pathname === '/api/notes' && req.method === 'GET') return send(200, listNotes(db, session))
    if (url.pathname === '/api/notes' && req.method === 'POST') return send(201, createNote(db, session, await readBody(req)))
    if (url.pathname === '/api/notes/clear-pending' && req.method === 'POST') return send(200, clearPendingNotes(db, session))
    const noteAction = url.pathname.match(/^\/api\/notes\/(\d+)\/(entries|complete)$/)
    if (noteAction && req.method === 'POST') {
      return send(200, noteAction[2] === 'entries'
        ? appendNote(db, session, Number(noteAction[1]), await readBody(req))
        : completeNote(db, session, Number(noteAction[1])))
    }

    if (req.method === 'GET' && url.pathname === '/api/roles/history') {
      const roles = db.prepare(`SELECT r.*, a.nombre || ' ' || a.apellido AS assigned_name,
        b.nombre || ' ' || b.apellido AS replacement_name FROM roles r
        JOIN users a ON a.id = r.assigned_user LEFT JOIN users b ON b.id = r.replace_user ORDER BY r.date`).all()
      return send(200, { roles })
    }
    if (req.method === 'GET' && url.pathname === '/api/users') {
      if (!canManageUsers) return send(403, { error: 'No tiene permiso para consultar usuarios' })
      return send(200, { users: db.prepare("SELECT id, username, nombre, apellido, rol_usuario, ultimo_rol, activo, password_reset_at FROM users WHERE lower(username) != 'admin' ORDER BY nombre, apellido, id").all() })
    }
    const userRoleMatch = url.pathname.match(/^\/api\/users\/(\d+)\/role$/)
    if (req.method === 'PATCH' && userRoleMatch) {
      return send(200, changeUserRole(db, session.id, Number(userRoleMatch[1]), await readBody(req)))
    }
    const resetMatch = url.pathname.match(/^\/api\/users\/(\d+)\/reset-password$/)
    if (req.method === 'POST' && resetMatch) {
      if (!canManageUsers) return send(403, { error: 'No tiene permiso para restablecer contraseñas' })
      const target = db.prepare('SELECT id, username, nombre, apellido FROM users WHERE id = ?').get(resetMatch[1])
      if (!target) return send(404, { error: 'Usuario no encontrado' })
      if (target.username.toLowerCase() === 'admin') return send(403, { error: 'La cuenta admin está protegida' })
      const credentials = await genericPasswordCredentials(target.nombre, target.apellido)
      db.prepare('UPDATE users SET password_hash = ?, password_reset_at = ? WHERE id = ?').run(credentials.password_hash, credentials.password_reset_at, target.id)
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id)
      failures.delete(`password:${target.id}`)
      return send(200, { id: target.id, password_reset_at: credentials.password_reset_at })
    }
    const activityMatch = url.pathname.match(/^\/api\/users\/(\d+)\/active$/)
    if (req.method === 'PATCH' && activityMatch) {
      if (session.rol_usuario !== 'superadmin') return send(403, { error: 'Solo un superadmin puede modificar el estado activo' })
      const data = await readBody(req)
      if (typeof data?.activo !== 'boolean') return send(400, { error: 'Estado inválido' })
      const target = db.prepare('SELECT id, username FROM users WHERE id = ?').get(activityMatch[1])
      if (!target) return send(404, { error: 'Usuario no encontrado' })
      if (target.username.toLowerCase() === 'admin') return send(403, { error: 'La cuenta admin está protegida' })
      db.prepare('UPDATE users SET activo = ? WHERE id = ?').run(Number(data.activo), target.id)
      if (!data.activo) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id)
      return send(200, { id: target.id, activo: data.activo })
    }
    const replacementMatch = url.pathname.match(/^\/api\/roles\/(\d+)\/replacements$/)
    if (req.method === 'GET' && replacementMatch) return send(200, replacementOptions(db, Number(replacementMatch[1]), session.id))
    const switchMatch = url.pathname.match(/^\/api\/roles\/(\d+)\/switch$/)
    if (req.method === 'PATCH' && switchMatch) return send(200, switchAssignment(db, Number(switchMatch[1]), session.id, await readBody(req)))
    if (req.method === 'POST' && url.pathname === '/api/roles/ensure-current') return send(200, ensureCurrentWeek(db))
    if (req.method === 'GET' && url.pathname === '/api/roles') {
      const start = url.searchParams.get('start')
      if (start !== null) {
        const date = new Date(`${start}T12:00:00Z`)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== start || date.getUTCDay() !== 1)
          return send(400, { error: 'Inicio de semana inválido' })
        return send(200, { ...listWeekStarting(db, start), isCurrentWeek: start === weekRange().start })
      }
      const week = url.searchParams.get('week') || 'current'
      if (!['current', 'previous'].includes(week)) return send(400, { error: 'Semana inválida' })
      return send(200, listWeek(db, week === 'previous' ? -1 : 0))
    }
    if (req.method === 'POST' && url.pathname === '/api/users') {
      if (!['admin', 'superadmin'].includes(session.rol_usuario)) return send(403, { error: 'No tiene permiso para crear usuarios' })
      const data = await readBody(req)
      const text = key => typeof data?.[key] === 'string' ? data[key].trim() : ''
      const username = text('username'), nombre = text('nombre'), apellido = text('apellido')
      const role = data?.rol_usuario ?? 'usuario'
      if ([username, nombre, apellido].some(value => !value || value.length > 100))
        return send(400, { error: 'Complete usuario, nombre y apellido (máximo 100 caracteres).' })
      if (!['usuario', 'admin'].includes(role)) return send(400, { error: 'Rol de usuario inválido' })
      const activo = data?.activo === undefined ? true : data.activo
      if (activo !== null && typeof activo !== 'boolean') return send(400, { error: 'Estado inválido' })
      const ultimo = data?.ultimo_rol || null
      if (ultimo !== null && (typeof ultimo !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ultimo) || !db.prepare("SELECT date(?, '+0 days') = ? AS valid").get(ultimo, ultimo).valid))
        return send(400, { error: 'Fecha de último rol inválida' })
      if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) return send(409, { error: 'El usuario ya existe' })
      const credentials = await genericPasswordCredentials(nombre, apellido)
      try {
        const result = db.prepare('INSERT INTO users (username, password_hash, nombre, apellido, ultimo_rol, activo, rol_usuario, password_reset_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(username, credentials.password_hash, nombre, apellido, ultimo, activo === null ? null : Number(activo), role, credentials.password_reset_at)
        return send(201, { user: { id: Number(result.lastInsertRowid), username, nombre, apellido, ultimo_rol: ultimo, activo, rol_usuario: role, password_reset_at: credentials.password_reset_at } })
      } catch (error) {
        if (error.message.includes('UNIQUE constraint failed')) return send(409, { error: 'El usuario ya existe' })
        throw error
      }
    }
    if (req.method === 'GET' && req.url === '/api/members') return send(200, list.all())
    if (req.method === 'POST' && req.url === '/api/members') {
      const data = await readBody(req)
      const name = typeof data?.name === 'string' ? data.name.trim() : ''
      if (!name || name.length > 100) return send(400, { error: 'Name must contain 1–100 characters' })
      const result = insert.run(name)
      return send(201, { id: Number(result.lastInsertRowid), name })
    }
    send(404, { error: 'Not found' })
  } catch (error) {
    console.error(error)
    if (!res.headersSent) send(error.status || 500, { error: error.status ? error.message : 'Unable to complete request' })
    else res.end()
  }
})
server.listen(Number(process.env.API_PORT || 3001), '127.0.0.1', () => console.log('SQLite API ready'))
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => { db.close(); process.exit(0) }))
}
