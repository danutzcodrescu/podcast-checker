// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { describe, expect, it } from 'vitest'

const testUrl = process.env.PODCAST_TEST_DATABASE_URL

describe.runIf(!!testUrl)('feature flag migration', () => {
  it('seeds disabled signup, defaults new flags to false, and permits toggling', async () => {
    const pool = new Pool({ connectionString: testUrl })
    const client = await pool.connect()
    const schema = `feature_flags_${randomUUID().replaceAll('-', '')}`
    try {
      await client.query('BEGIN')
      await client.query(`CREATE SCHEMA "${schema}"`)
      await client.query(`SET LOCAL search_path TO "${schema}", public`)
      await client.query(await readFile('./drizzle/0008_feature_flags.sql', 'utf8'))
      expect((await client.query('SELECT * FROM feature_flag')).rows).toEqual([
        { key: 'signup_enabled', enabled: false },
      ])

      await client.query("INSERT INTO feature_flag (key) VALUES ('another_feature')")
      expect(
        (await client.query("SELECT enabled FROM feature_flag WHERE key = 'another_feature'"))
          .rows[0].enabled,
      ).toBe(false)

      await client.query("UPDATE feature_flag SET enabled = true WHERE key = 'signup_enabled'")
      expect(
        (await client.query("SELECT enabled FROM feature_flag WHERE key = 'signup_enabled'"))
          .rows[0].enabled,
      ).toBe(true)
      await client.query("UPDATE feature_flag SET enabled = false WHERE key = 'signup_enabled'")
      expect(
        (await client.query("SELECT enabled FROM feature_flag WHERE key = 'signup_enabled'"))
          .rows[0].enabled,
      ).toBe(false)
    } finally {
      await client.query('ROLLBACK')
      client.release()
      await pool.end()
    }
  })
})
