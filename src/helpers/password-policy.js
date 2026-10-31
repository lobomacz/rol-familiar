export const passwordRequirements = [
  { label: 'Exactamente 12 caracteres', test: value => value.length === 12 },
  { label: 'Una letra minúscula', test: value => /[a-z]/.test(value) },
  { label: 'Una letra mayúscula', test: value => /[A-Z]/.test(value) },
  { label: 'Exactamente un número', test: value => (value.match(/[0-9]/g) || []).length === 1 },
  { label: 'Exactamente un símbolo, sin espacios', test: value => (value.match(/[^a-zA-Z0-9\s]/g) || []).length === 1 && !/\s/.test(value) },
]
export const isStrongPassword = value => typeof value === 'string' && passwordRequirements.every(rule => rule.test(value))
