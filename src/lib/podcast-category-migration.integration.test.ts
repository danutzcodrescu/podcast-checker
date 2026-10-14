// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { describe, expect, it } from 'vitest'

const testUrl = process.env.PODCAST_TEST_DATABASE_URL

describe.runIf(!!testUrl)('category index repair', () => {
  it('preserves category assignments and account isolation, and makes repeated inserts idempotent', async () => {
    const pool = new Pool({ connectionString: testUrl })
    const client = await pool.connect()
    const schema = `category_repair_${randomUUID().replaceAll('-', '')}`
    try {
      await client.query('BEGIN')
      await client.query(`CREATE SCHEMA "${schema}"`)
      await client.query(`SET LOCAL search_path TO "${schema}", public`)
      // Omit uniqueness to reproduce the rows admitted by the old corrupt index.
      await client.query(`CREATE TABLE podcast_category (
        user_id text NOT NULL, id text NOT NULL, name text NOT NULL
      )`)
      await client.query(`CREATE TABLE followed_podcast (
        user_id text NOT NULL, podcast_id integer NOT NULL, categories text[] NOT NULL,
        PRIMARY KEY (user_id, podcast_id)
      )`)
      await client.query(`INSERT INTO podcast_category VALUES
        ('first', 'history', 'History'), ('first', 'history', 'history'),
        ('first', 'story', 'Story'), ('second', 'history', 'History')`)
      await client.query(`INSERT INTO followed_podcast VALUES
        ('first', 1, ARRAY['history', 'story']), ('second', 1, ARRAY['history'])`)
      const assignments = (await client.query('SELECT * FROM followed_podcast ORDER BY user_id'))
        .rows
      const indexFile = () =>
        client.query("SELECT pg_relation_filenode('followed_podcast_pkey') AS file")
      const originalIndex = (await indexFile()).rows[0].file
      const migration = await readFile('./drizzle/0004_repair_library_indexes.sql', 'utf8')
      await client.query(migration)
      expect((await indexFile()).rows[0].file).not.toBe(originalIndex)
      const expected = [
        { user_id: 'first', id: 'history', name: 'History' },
        { user_id: 'first', id: 'story', name: 'Story' },
        { user_id: 'second', id: 'history', name: 'History' },
      ]
      expect(
        (await client.query('SELECT * FROM podcast_category ORDER BY user_id, id')).rows,
      ).toEqual(expected)
      expect((await client.query('SELECT * FROM followed_podcast ORDER BY user_id')).rows).toEqual(
        assignments,
      )

      // The cleaned data must support the real schema's primary key, and the
      // migration must also work on an already healthy table with that key.
      await client.query('ALTER TABLE podcast_category ADD PRIMARY KEY (user_id, id)')
      await client.query(migration)
      for (let attempt = 0; attempt < 3; attempt++) {
        // eslint-disable-next-line no-await-in-loop -- Reuse the transaction's client sequentially.
        const inserted = await client.query(`INSERT INTO podcast_category
          VALUES ('first', 'history', 'history') ON CONFLICT DO NOTHING RETURNING id`)
        expect(inserted.rowCount).toBe(0)
      }
      expect(
        (await client.query('SELECT * FROM podcast_category ORDER BY user_id, id')).rows,
      ).toEqual(expected)
    } finally {
      await client.query('ROLLBACK')
      client.release()
      await pool.end()
    }
  })
})
