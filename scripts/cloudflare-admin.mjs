import { writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { hashPassword } from '../server/auth.mjs'

const index = process.argv.indexOf('--file')
const file = index >= 0 ? process.argv[index + 1] : null
if (!file) throw new Error('Uso: npm run cf:admin -- --file /ruta/privada/admin.sql')
const password = randomBytes(18).toString('base64url')
const hash = await hashPassword(password)
// Fails instead of overwriting an existing account. The password never enters SQL.
const sql = `INSERT INTO write_guards (id, valid) SELECT 'bootstrap-admin', CASE WHEN count(*) = 0 THEN 1 ELSE 0 END FROM users;
INSERT INTO users (id, username, password_hash, nombre, apellido, rol_usuario, activo, password_reset_at)
VALUES (1, 'admin', '${hash}', 'Superadmin', 'Sin especificar', 'superadmin', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
UPDATE app_revision SET version = version + 1 WHERE id = 1;
DELETE FROM write_guards WHERE id = 'bootstrap-admin';\n`
await writeFile(file, sql, { mode: 0o600, flag: 'wx' })
console.log(`SQL de inicialización guardado en: ${file}`)
console.log(`Usuario: admin\nContraseña temporal: ${password}\nDebe cambiarla al iniciar sesión.`)
