import { database } from './database.mjs'
import { reorganizeWeek, reassignDay, changeUserRole, listNotes, createNote, appendNote, completeNote, clearPendingNotes, replacementOptions, switchAssignment, ensureCurrentWeek, listWeekStarting, listWeek } from './services.mjs'
import { weekRange } from '../server/roles.mjs'
import { genericPasswordCredentials } from '../server/password-reset.mjs'
import { isStrongPassword } from '../src/helpers/password-policy.js'
import { hashPassword, verifyPassword, tokenHash, newToken } from '../server/auth.mjs'

const failureMessage = 'Sus datos de acceso no son correctos!'
const sessionDuration = 8 * 60 * 60 * 1000
let dummyHash
const dummyPasswordHash = () => dummyHash ||= hashPassword(newToken())
async function readBody(request) {
  if (!request.body) throw Object.assign(new Error('JSON inválido'), { status: 400 })
  const reader = request.body.getReader()
  const chunks = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > 8192) { await reader.cancel(); throw Object.assign(new Error('Solicitud demasiado grande'), { status: 413 }) }
    chunks.push(value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  try { return JSON.parse(new TextDecoder().decode(bytes)) } catch { throw Object.assign(new Error('JSON inválido'), { status: 400 }) }
}
async function handleOnce(request, env) {
  const responseHeaders = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  const res = { setHeader: (name, value) => responseHeaders.set(name, value) }
  const url = new URL(request.url)
  const req = { method: request.method, url: url.pathname + url.search, headers: Object.fromEntries(request.headers), socket: { remoteAddress: request.headers.get('CF-Connecting-IP') || 'local' } }
  req.headers.host = url.host
  const cookie = (token, age) => `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${url.protocol === 'https:' ? '; Secure' : ''}`
  const send = (status, body) => new Response(JSON.stringify(body), { status, headers: responseHeaders })
  if (!env.DB) return send(503, { error: 'Falta configurar la base de datos D1 (DB)' })

  try {
    const db = await database(env.DB)
    if (req.method === 'GET' && req.url === '/api/health') {
      await db.prepare('SELECT 1').get()
      return send(200, { status: 'ok', database: 'd1' })
    }
    // Pages serves the frontend and API on the same origin.
    if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin) {
      let origin
      try { origin = new URL(req.headers.origin).origin } catch { return send(403, { error: 'Origen no permitido' }) }
      if (origin !== url.origin) return send(403, { error: 'Origen no permitido' })
    }
    const token = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('session='))?.slice(8) || ''
    const session = (await db.prepare(`SELECT users.id, users.username, users.nombre, users.apellido, users.ultimo_rol, users.activo, users.rol_usuario, users.password_reset_at FROM sessions JOIN users ON users.id = sessions.user_id WHERE token_hash = ? AND expires_at > ? AND (users.rol_usuario = 'superadmin' OR users.activo = 1)`).get(tokenHash(token), Date.now()))
    if (req.method === 'POST' && req.url === '/api/auth/login') {
      const key = tokenHash(`login:${req.socket.remoteAddress}`)
      const now = Date.now()
      const attempt = await db.attempt(key)
      if (attempt.count > 10) return send(429, { error: failureMessage })
      const data = await readBody(request)
      const username = typeof data?.username === 'string' ? data.username.trim() : ''
      const password = typeof data?.password === 'string' ? data.password : ''
      if (username.length > 100 || !password || password.length > 1024) return send(401, { error: failureMessage })
      const user = (await db.prepare('SELECT * FROM users WHERE username = ?').get(username))
      const valid = await verifyPassword(password, user?.password_hash || await dummyPasswordHash())
      if (!user || !valid || (user.rol_usuario !== 'superadmin' && user.activo !== 1)) {
        return send(401, { error: failureMessage })
      }
      await db.clearAttempt(key)
      const nextToken = newToken()
      await db.atomic([
        ['DELETE FROM sessions WHERE token_hash = ? OR expires_at <= ?', [tokenHash(token), now]],
        ['INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [tokenHash(nextToken), user.id, now + sessionDuration]],
        ['DELETE FROM auth_attempts WHERE expires_at <= ?', [now]],
      ])
      res.setHeader('Set-Cookie', cookie(nextToken, sessionDuration / 1000))
      const { password_hash, ...profile } = user
      return send(200, { user: profile })
    }
    if (req.method === 'POST' && req.url === '/api/auth/logout') {
      await db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token))
      res.setHeader('Set-Cookie', cookie('', 0))
      return send(200, { ok: true })
    }
    if (!session) return send(401, { error: 'Debe iniciar sesión' })
    if (req.method === 'GET' && req.url === '/api/auth/me') return send(200, { user: session })
    // URL already parsed at the request boundary.
    if (req.method === 'POST' && url.pathname === '/api/auth/password') {
      const key = tokenHash(`password:${session.id}`)
      const attempt = await db.attempt(key)
      if (attempt.count > 10) return send(429, { error: 'Demasiados intentos. Intente de nuevo en 15 minutos.' })
      const data = await readBody(request)
      if (typeof data?.currentPassword !== 'string' || !data.currentPassword || data.currentPassword.length > 1024)
        return send(400, { error: 'Ingrese su contraseña actual' })
      if (!isStrongPassword(data?.newPassword)) return send(400, { error: 'La nueva contraseña debe tener exactamente 12 caracteres, minúsculas, mayúsculas, exactamente un número y un símbolo, sin espacios.' })
      if (data.newPassword === data.currentPassword) return send(400, { error: 'La nueva contraseña debe ser diferente de la actual' })
      if (data.confirmPassword !== data.newPassword) return send(400, { error: 'Las contraseñas no coinciden' })
      const account = (await db.prepare('SELECT password_hash FROM users WHERE id = ?').get(session.id))
      if (!await verifyPassword(data.currentPassword, account.password_hash)) {
        return send(400, { error: 'La contraseña actual no es correcta' })
      }
      const hash = await hashPassword(data.newPassword)
      await db.atomic([
        ['UPDATE users SET password_hash = ?, password_reset_at = NULL WHERE id = ? AND password_hash = ?', [hash, session.id, account.password_hash]],
        ['DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', [session.id, tokenHash(token)]],
      ])
      await db.clearAttempt(key)
      return send(200, { ok: true })
    }
    if (session.password_reset_at) return send(403, { error: 'Debe cambiar su contraseña antes de continuar', code: 'PASSWORD_CHANGE_REQUIRED' })
    const canManageUsers = ['admin', 'superadmin'].includes(session.rol_usuario)
    if (url.pathname === '/api/notes' && req.method === 'GET') return send(200, (await listNotes(db, session)))
    if (url.pathname === '/api/notes' && req.method === 'POST') return send(201, (await createNote(db, session, await readBody(request))))
    if (url.pathname === '/api/notes/clear-pending' && req.method === 'POST') return send(200, (await clearPendingNotes(db, session)))
    const noteAction = url.pathname.match(/^\/api\/notes\/(\d+)\/(entries|complete)$/)
    if (noteAction && req.method === 'POST') {
      return send(200, noteAction[2] === 'entries'
        ? (await appendNote(db, session, Number(noteAction[1]), await readBody(request)))
        : (await completeNote(db, session, Number(noteAction[1]))))
    }

    if (req.method === 'GET' && url.pathname === '/api/roles/history') {
      const roles = (await db.prepare(`SELECT r.*, a.nombre || ' ' || a.apellido AS assigned_name,
        b.nombre || ' ' || b.apellido AS replacement_name FROM roles r
        JOIN users a ON a.id = r.assigned_user LEFT JOIN users b ON b.id = r.replace_user ORDER BY r.date`).all())
      return send(200, { roles })
    }
    if (req.method === 'GET' && url.pathname === '/api/users') {
      if (!canManageUsers) return send(403, { error: 'No tiene permiso para consultar usuarios' })
      return send(200, { users: (await db.prepare("SELECT id, username, nombre, apellido, rol_usuario, ultimo_rol, activo, password_reset_at FROM users WHERE lower(username) != 'admin' ORDER BY nombre, apellido, id").all()) })
    }
    const userRoleMatch = url.pathname.match(/^\/api\/users\/(\d+)\/role$/)
    if (req.method === 'PATCH' && userRoleMatch) {
      return send(200, (await changeUserRole(db, session.id, Number(userRoleMatch[1]), await readBody(request))))
    }
    const resetMatch = url.pathname.match(/^\/api\/users\/(\d+)\/reset-password$/)
    if (req.method === 'POST' && resetMatch) {
      if (!canManageUsers) return send(403, { error: 'No tiene permiso para restablecer contraseñas' })
      const target = (await db.prepare('SELECT id, username, nombre, apellido FROM users WHERE id = ?').get(resetMatch[1]))
      if (!target) return send(404, { error: 'Usuario no encontrado' })
      if (target.username.toLowerCase() === 'admin') return send(403, { error: 'La cuenta admin está protegida' })
      const credentials = await genericPasswordCredentials(target.nombre, target.apellido)
      await db.atomic([
        ['UPDATE users SET password_hash = ?, password_reset_at = ? WHERE id = ?', [credentials.password_hash, credentials.password_reset_at, target.id]],
        ['DELETE FROM sessions WHERE user_id = ?', [target.id]],
      ])
      await db.clearAttempt(tokenHash(`password:${target.id}`))
      return send(200, { id: target.id, password_reset_at: credentials.password_reset_at })
    }
    const activityMatch = url.pathname.match(/^\/api\/users\/(\d+)\/active$/)
    if (req.method === 'PATCH' && activityMatch) {
      if (session.rol_usuario !== 'superadmin') return send(403, { error: 'Solo un superadmin puede modificar el estado activo' })
      const data = await readBody(request)
      if (typeof data?.activo !== 'boolean') return send(400, { error: 'Estado inválido' })
      const target = (await db.prepare('SELECT id, username FROM users WHERE id = ?').get(activityMatch[1]))
      if (!target) return send(404, { error: 'Usuario no encontrado' })
      if (target.username.toLowerCase() === 'admin') return send(403, { error: 'La cuenta admin está protegida' })
      await db.atomic([
        ['UPDATE users SET activo = ? WHERE id = ?', [Number(data.activo), target.id]],
        ...(!data.activo ? [['DELETE FROM sessions WHERE user_id = ?', [target.id]]] : []),
      ])
      return send(200, { id: target.id, activo: data.activo })
    }
    const assignmentMatch = url.pathname.match(/^\/api\/roles\/(\d+)\/assignment$/)
    if (req.method === 'PATCH' && assignmentMatch) return send(200, await reassignDay(db, session.id, Number(assignmentMatch[1]), await readBody(request)))
    const replacementMatch = url.pathname.match(/^\/api\/roles\/(\d+)\/replacements$/)
    if (req.method === 'GET' && replacementMatch) return send(200, (await replacementOptions(db, Number(replacementMatch[1]), session.id)))
    const switchMatch = url.pathname.match(/^\/api\/roles\/(\d+)\/switch$/)
    if (req.method === 'PATCH' && switchMatch) return send(200, (await switchAssignment(db, Number(switchMatch[1]), session.id, await readBody(request))))
    if (req.method === 'POST' && url.pathname === '/api/roles/reorganize') return send(200, await reorganizeWeek(db, session.id))
    if (req.method === 'POST' && url.pathname === '/api/roles/ensure-current') return send(200, (await ensureCurrentWeek(db)))
    if (req.method === 'GET' && url.pathname === '/api/roles') {
      const start = url.searchParams.get('start')
      if (start !== null) {
        const date = new Date(`${start}T12:00:00Z`)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== start || date.getUTCDay() !== 1)
          return send(400, { error: 'Inicio de semana inválido' })
        return send(200, { ...(await listWeekStarting(db, start)), isCurrentWeek: start === weekRange().start })
      }
      const week = url.searchParams.get('week') || 'current'
      if (!['current', 'previous'].includes(week)) return send(400, { error: 'Semana inválida' })
      return send(200, (await listWeek(db, week === 'previous' ? -1 : 0)))
    }
    if (req.method === 'POST' && url.pathname === '/api/users') {
      if (!['admin', 'superadmin'].includes(session.rol_usuario)) return send(403, { error: 'No tiene permiso para crear usuarios' })
      const data = await readBody(request)
      const text = key => typeof data?.[key] === 'string' ? data[key].trim() : ''
      const username = text('username'), nombre = text('nombre'), apellido = text('apellido')
      const role = data?.rol_usuario ?? 'usuario'
      if ([username, nombre, apellido].some(value => !value || value.length > 100))
        return send(400, { error: 'Complete usuario, nombre y apellido (máximo 100 caracteres).' })
      if (!['usuario', 'admin'].includes(role)) return send(400, { error: 'Rol de usuario inválido' })
      const activo = data?.activo === undefined ? true : data.activo
      if (activo !== null && typeof activo !== 'boolean') return send(400, { error: 'Estado inválido' })
      const ultimo = data?.ultimo_rol || null
      if (ultimo !== null && (typeof ultimo !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ultimo) || !(await db.prepare("SELECT date(?, '+0 days') = ? AS valid").get(ultimo, ultimo)).valid))
        return send(400, { error: 'Fecha de último rol inválida' })
      if ((await db.prepare('SELECT id FROM users WHERE username = ?').get(username))) return send(409, { error: 'El usuario ya existe' })
      const credentials = await genericPasswordCredentials(nombre, apellido)
      try {
        const result = (await db.prepare('INSERT INTO users (username, password_hash, nombre, apellido, ultimo_rol, activo, rol_usuario, password_reset_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(username, credentials.password_hash, nombre, apellido, ultimo, activo === null ? null : Number(activo), role, credentials.password_reset_at))
        return send(201, { user: { id: Number(result.lastInsertRowid), username, nombre, apellido, ultimo_rol: ultimo, activo, rol_usuario: role, password_reset_at: credentials.password_reset_at } })
      } catch (error) {
        if (error.message.includes('UNIQUE constraint failed')) return send(409, { error: 'El usuario ya existe' })
        throw error
      }
    }
    if (req.method === 'GET' && req.url === '/api/members') return send(200, (await db.prepare('SELECT id, name FROM members ORDER BY id').all()))
    if (req.method === 'POST' && req.url === '/api/members') {
      const data = await readBody(request)
      const name = typeof data?.name === 'string' ? data.name.trim() : ''
      if (!name || name.length > 100) return send(400, { error: 'Name must contain 1–100 characters' })
      const result = (await db.prepare('INSERT INTO members (name) VALUES (?)').run(name))
      return send(201, { id: Number(result.lastInsertRowid), name })
    }
    return send(404, { error: 'Not found' })
  } catch (error) {
    if (!error.status) console.error('API failure', error.message)
    return send(error.status || 500, { error: error.status ? error.message : 'No se pudo completar la solicitud', ...(error.code ? { code: error.code } : {}) })
  }
}

export async function handleRequest(request, env) {
  // Initialization is idempotent. Retry concurrent first-open requests safely.
  const retryable = request.method === 'POST' && new URL(request.url).pathname === '/api/roles/ensure-current'
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await handleOnce(request.clone(), env)
    if (!retryable || response.status !== 409 || attempt === 2) return response
  }
}
