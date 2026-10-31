import { readFile, readdir } from 'node:fs/promises'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
export function sqlStatements(sql) {
  const triggers = sql.match(/CREATE TRIGGER[\s\S]*?END;/g) || []
  return [...sql.replace(/CREATE TRIGGER[\s\S]*?END;/g, '').split(';').map(value => value.trim()).filter(Boolean), ...triggers]
}
export async function fixture() {
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, scriptPath: '.cloudflare-build/index.js', compatibilityDate: '2026-10-30', compatibilityFlags: ['nodejs_compat'], d1Databases: { DB: 'test-database' } }))
  try {
    const db = await runtime.getD1Database('DB')
    for (const file of (await readdir('migrations')).filter(file => file.endsWith('.sql')).sort()) {
      const schema = await readFile(`migrations/${file}`, 'utf8')
      await db.batch(sqlStatements(schema).map(sql => db.prepare(sql)))
    }
    return { runtime, db }
  } catch (error) { await runtime.dispose(); throw error }
}
