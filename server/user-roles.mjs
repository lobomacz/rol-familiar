import { canChangeUserRole } from '../src/helpers/user-role-policy.js'
const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }
export function changeUserRole(db, actorId, targetId, data) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const actor = db.prepare('SELECT rol_usuario, activo FROM users WHERE id = ?').get(actorId)
    if (!actor || (actor.rol_usuario !== 'superadmin' && actor.activo !== 1)) fail(403, 'No tiene permiso para modificar roles')
    const target = db.prepare('SELECT id, username, rol_usuario FROM users WHERE id = ?').get(targetId)
    if (!target) fail(404, 'Usuario no encontrado')
    if (!canChangeUserRole(actor, target)) fail(403, 'Solo un superadmin puede modificar el rol de un administrador; las cuentas superadmin están protegidas')
    if (!['usuario', 'admin'].includes(data?.rol_usuario)) fail(400, 'Rol de usuario inválido')
    db.prepare('UPDATE users SET rol_usuario = ? WHERE id = ?').run(data.rol_usuario, targetId)
    db.exec('COMMIT')
    return { id: targetId, rol_usuario: data.rol_usuario }
  } catch (error) { db.exec('ROLLBACK'); throw error }
}
