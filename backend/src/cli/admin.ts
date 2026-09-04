/**
 * Creates or promotes an admin account from the command line:
 *
 *   npm --prefix backend run admin -- <username> <password>
 *
 * Useful for the very first account on a headless Pi, or for recovering access
 * when you've locked yourself out of the panel.
 */
import { config } from '../config.js';
import { assertDatabaseReachable, closePool, runMigrations } from '../db/pool.js';
import { upsertAdmin } from '../lib/auth.js';

const logger = { info: (message: string) => console.log(`[admin] ${message}`) };

async function main() {
  const [username, password] = process.argv.slice(2);

  if (!username || !password) {
    console.error('Usage: npm --prefix backend run admin -- <username> <password>');
    process.exit(2);
  }

  if (!config.authEnabled) {
    console.error('AUTH_ENABLED is false — accounts are disabled on this server.');
    process.exit(2);
  }

  await assertDatabaseReachable();
  await runMigrations(logger);

  const user = await upsertAdmin(username, password);
  logger.info(`${user.username} is now an admin (id ${user.id}).`);
  await closePool();
}

main().catch(async (error) => {
  console.error('[admin] failed:', error instanceof Error ? error.message : error);
  await closePool().catch(() => undefined);
  process.exit(1);
});
