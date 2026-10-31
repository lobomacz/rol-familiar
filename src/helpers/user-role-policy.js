export function canChangeUserRole(actor, target) {
  if (!actor || !target || target.username?.toLowerCase() === 'admin' || target.rol_usuario === 'superadmin') return false
  return actor.rol_usuario === 'superadmin' || (actor.rol_usuario === 'admin' && target.rol_usuario === 'usuario')
}
