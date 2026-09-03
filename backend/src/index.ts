import fs from 'node:fs/promises';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import compress from '@fastify/compress';

import { config } from './config.js';
import { library } from './lib/library.js';
import { apiRoutes } from './routes/api.js';
import { mediaRoutes } from './routes/media.js';

async function main() {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      transport: process.stdout.isTTY
        ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
        : undefined,
    },
    // Range requests and long downloads must not be cut short.
    connectionTimeout: 0,
    requestTimeout: 0,
    // Trust the reverse proxy (cloudflared / Tailscale) in front of us.
    trustProxy: true,
  });

  /**
   * Compression is content-type aware: audio and JPEG are already compressed
   * and are passed through untouched, so range requests stay byte-exact.
   */
  await app.register(compress, {
    global: true,
    threshold: 1024,
    encodings: ['br', 'gzip', 'deflate'],
  });

  const allowAnyOrigin = config.corsOrigins.includes('*');
  await app.register(cors, {
    origin: allowAnyOrigin ? true : config.corsOrigins,
    methods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
    // Browsers need these exposed for seeking and progress UI.
    exposedHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges', 'Content-Disposition'],
    maxAge: 86400,
  });

  await app.register(apiRoutes, { prefix: '/api' });
  await app.register(mediaRoutes, { prefix: '/api' });

  app.get('/', async () => ({
    name: 'boozie-archive-api',
    docs: '/api/health',
    tracks: library.snapshot.tracks.length,
  }));

  // --- library bootstrap -------------------------------------------------

  try {
    const stat = await fs.stat(config.musicRoot);
    if (!stat.isDirectory()) throw new Error('not a directory');
  } catch {
    app.log.error(
      `MUSIC_ROOT "${config.musicRoot}" is not readable. ` +
        'Set MUSIC_ROOT in backend/.env to your collection path.',
    );
  }

  await fs.mkdir(config.dataDir, { recursive: true });
  const hadCache = await library.loadFromDisk(app.log);

  await app.listen({ host: config.host, port: config.port });
  app.log.info(`Serving on http://${config.host}:${config.port} — music root ${config.musicRoot}`);

  /**
   * The scan runs after `listen()` so the API is immediately reachable; the
   * cached index (if any) keeps serving while a rescan is in flight.
   */
  if (config.scanOnStart || !hadCache) {
    library.rescan(app.log).catch((error) => app.log.error({ err: error }, 'Initial scan failed'));
  }

  let timer: NodeJS.Timeout | null = null;
  if (config.scanIntervalMinutes > 0) {
    timer = setInterval(
      () => {
        app.log.info('Starting scheduled rescan');
        library.rescan(app.log).catch((error) => app.log.error({ err: error }, 'Rescan failed'));
      },
      config.scanIntervalMinutes * 60_000,
    );
    timer.unref();
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      app.log.info(`${signal} received, shutting down`);
      if (timer) clearInterval(timer);
      app.close().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
  }
}

main().catch((error) => {
  console.error('Fatal startup error:', error);
  process.exit(1);
});
