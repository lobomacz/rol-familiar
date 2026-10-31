import { hashPassword } from './auth.mjs'

// Trim each name, concatenate without a separator, and lowercase the result.
export async function genericPasswordCredentials(nombre, apellido) {
  return {
    password_hash: await hashPassword(`${nombre.trim()}${apellido.trim()}`.toLowerCase()),
    password_reset_at: new Date().toISOString(),
  }
}
