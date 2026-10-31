export const passwordRequirements = [
  { label: 'Exactamente 16 caracteres', test: value => value.length === 16 },
  { label: 'Una letra minúscula', test: value => /[a-z]/.test(value) },
  { label: 'Una letra mayúscula', test: value => /[A-Z]/.test(value) },
  { label: 'Un número', test: value => /[0-9]/.test(value) },
  { label: 'Un símbolo', test: value => /[^a-zA-Z0-9\s]/.test(value) },
]
export const isStrongPassword = value => typeof value === 'string' && passwordRequirements.every(rule => rule.test(value))
