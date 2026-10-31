// All reads go to the primary. A revision guard turns stale read/modify/write
// requests into retryable conflicts; D1 rolls the entire batch back on failure.
export async function database(binding) {
  const session = binding.withSession('first-primary')
  let version = (await session.prepare('SELECT version FROM app_revision WHERE id = 1').first()).version
  const statement = (sql, args = []) => session.prepare(sql).bind(...args)
  const db = {
    prepare(sql) {
      return {
        get: (...args) => statement(sql, args).first(),
        all: async (...args) => (await statement(sql, args).all()).results,
        run: async (...args) => (await db.atomic([[sql, args]]))[0],
      }
    },
    async atomic(queries) {
      if (!queries.length) return []
      const guard = crypto.randomUUID()
      try {
        const result = await session.batch([
          statement('INSERT INTO write_guards (id, valid) SELECT ?, CASE WHEN version = ? THEN 1 ELSE 0 END FROM app_revision WHERE id = 1', [guard, version]),
          ...queries.map(([sql, args]) => statement(sql, args)),
          statement('UPDATE app_revision SET version = version + 1 WHERE id = 1'),
          statement('DELETE FROM write_guards WHERE id = ?', [guard]),
        ])
        version++
        return result.slice(1, -2).map(item => ({ changes: item.meta.changes, lastInsertRowid: item.meta.last_row_id }))
      } catch (error) {
        if (String(error.message).includes('CHECK constraint failed: valid'))
          throw Object.assign(new Error('Los datos cambiaron. Actualice la página e intente de nuevo.'), { status: 409, code: 'WRITE_CONFLICT' })
        throw error
      }
    },
    // Login throttles do not alter business data; UPSERT increments atomically.
    async attempt(key) {
      return statement(`INSERT INTO auth_attempts (key, count, expires_at) VALUES (?, 1, ?)
        ON CONFLICT(key) DO UPDATE SET count = CASE WHEN expires_at <= ? THEN 1 ELSE count + 1 END,
        expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END RETURNING count`,
      [key, Date.now() + 900000, Date.now(), Date.now()]).first()
    },
    async clearAttempt(key) { await statement('DELETE FROM auth_attempts WHERE key = ?', [key]).run() },
  }
  return db
}
