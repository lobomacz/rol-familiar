import { createInterface } from 'node:readline/promises'
import { randomBytes } from 'node:crypto'
import { openDatabase } from '../server/database.mjs'
import { hashPassword } from '../server/auth.mjs'

const username = process.argv[2]?.trim()
if (!username || username.length > 100) throw new Error('Uso: npm run user:create -- <usuario> [--generate]')
let password = process.env.USER_PASSWORD
if (process.argv.includes('--generate')) password = randomBytes(18).toString('base64url')
if (!password) {
  if (process.stdin.isTTY) throw new Error('Use --generate o proporcione USER_PASSWORD mediante una variable de entorno.')
  const input = createInterface({ input: process.stdin })
  for await (const line of input) { password = line; break }
  input.close()
}
if (!password || password.length < 12 || password.length > 1024) throw new Error('La contraseña debe tener entre 12 y 1024 caracteres.')
const db = openDatabase()
try {
  const option = (name, fallback) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1] }
  const initialAdmin = username.toLowerCase() === 'admin' && db.prepare('SELECT count(*) AS count FROM users').get().count === 0
  const role = initialAdmin ? 'superadmin' : option('--rol', 'usuario')
  if (!['usuario', 'admin'].includes(role) && !(role === 'superadmin' && username.toLowerCase() === 'admin' && db.prepare('SELECT count(*) AS count FROM users').get().count === 0))
    throw new Error('Solo se permiten los roles usuario y admin; superadmin está reservado para el usuario admin inicial.')
  db.prepare('INSERT INTO users (username, password_hash, nombre, apellido, rol_usuario) VALUES (?, ?, ?, ?, ?)').run(username, await hashPassword(password), initialAdmin ? 'Superadmin' : option('--nombre', username), option('--apellido', 'Sin especificar'), role)
  console.log(`Usuario creado: ${username}`)
  if (process.argv.includes('--generate')) console.log(`Contraseña: ${password}`)
} finally { db.close() }
