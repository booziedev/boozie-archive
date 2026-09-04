import pg from 'pg';

import { config } from '../config.js';
import { migrations } from './schema.js';

/**
 * PostgreSQL connection pool.
 *
 * A Pi is a small machine: the pool is deliberately narrow, and every query
 * goes through here rather than through per-request clients.
 */
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: config.databasePoolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  // Managed Postgres services need TLS; a local socket on the Pi does not.
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
});

/** Fail loudly at boot rather than on the first login attempt. */
export async function assertDatabaseReachable(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}

/**
 * Applies any migrations that haven't run yet. Safe to call on every boot and
 * safe against two processes starting at once, thanks to the advisory lock.
 */
export async function runMigrations(logger: { info: (m: string) => void }): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id         text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    // Serialises concurrent starts (pm2 restart racing a systemd unit, say).
    await client.query('SELECT pg_advisory_lock($1)', [4_919_231]);
    try {
      const { rows } = await client.query<{ id: string }>('SELECT id FROM schema_migrations');
      const applied = new Set(rows.map((row) => row.id));

      for (const migration of migrations) {
        if (applied.has(migration.id)) continue;
        logger.info(`Applying migration ${migration.id}`);
        await client.query('BEGIN');
        try {
          await client.query(migration.sql);
          await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id]);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [4_919_231]);
    }
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
