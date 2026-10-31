const namePart = value => {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  return /^(undefined|null|sin\s+especificar)$/i.test(text) ? '' : text
}

export const userDisplayName = user => [namePart(user.nombre), namePart(user.apellido)].filter(Boolean).join(' ')
