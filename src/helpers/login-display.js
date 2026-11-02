const formatter = new Intl.DateTimeFormat('es-NI', {
  dateStyle: 'medium', timeStyle: 'medium', timeZone: 'America/Managua',
})

export function formatLastLogin(value) {
  if (!value) return 'Sin inicios de sesión registrados'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Sin inicios de sesión registrados' : formatter.format(date)
}
