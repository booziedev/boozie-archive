/**
 * One-shot scanner: `npm run scan` (or `node dist/cli/scan.js`).
 *
 * Useful from cron or right after copying new music onto the Pi, so the
 * running server can pick the refreshed index up on its next restart — or use
 * `POST /api/rescan` to refresh it in place without downtime.
 */
import fs from 'node:fs/promises';

import { config } from '../config.js';
import { library } from '../lib/library.js';

const logger = {
  info: (message: string) => console.log(`[scan] ${message}`),
  warn: (message: string) => console.warn(`[scan] ${message}`),
};

async function main() {
  await fs.mkdir(config.dataDir, { recursive: true });
  logger.info(`Music root: ${config.musicRoot}`);
  await library.loadFromDisk(logger);
  const index = await library.rescan(logger);
  const stats = library.stats();
  logger.info(
    `Done: ${stats.tracks} tracks / ${stats.albums} albums / ${stats.artists} artists, ` +
      `${(stats.size / 1024 ** 3).toFixed(1)} GB, index written to ${config.indexFile}`,
  );
  process.exit(index ? 0 : 1);
}

main().catch((error) => {
  console.error('[scan] failed:', error);
  process.exit(1);
});
