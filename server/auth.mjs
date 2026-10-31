import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto'
import { promisify } from 'node:util'

const derive = promisify(scrypt)
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const key = await derive(password, salt, 64, options)
  return `scrypt$${salt}$${key.toString('hex')}`
}
export async function verifyPassword(password, encoded) {
  const [scheme, salt, hash] = encoded.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'hex')
  const actual = await derive(password, salt, 64, options)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
export const tokenHash = token => createHash('sha256').update(token).digest('hex')
export const newToken = () => randomBytes(32).toString('hex')
