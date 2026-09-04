import fs from 'node:fs/promises';
import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import fastifyStatic from '@fastify/static';

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

  /**
   * Serve the built frontend from the same process when it is present, so the
   * whole app lives behind a single port and a single tunnel. Deploying the
   * frontend to Cloudflare Pages instead still works: just don't build it here
   * (or set SERVE_FRONTEND=false) and the server stays API-only.
   */
  const frontendReady =
    config.serveFrontend &&
    (await fs
      .stat(path.join(config.frontendDist, 'index.html'))
      .then((stat) => stat.isFile())
      .catch(() => false));

  if (frontendReady) {
    await app.register(fastifyStatic, {
      root: config.frontendDist,
      // We set Cache-Control ourselves below; the plugin's default would
      // otherwise overwrite it with `public, max-age=0` for every file.
      cacheControl: false,
      // Hashed assets never change; the shell and the worker must not be pinned.
      setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    });

    /**
     * SPA fallback: a hard refresh on /albums/al_xxx has to return index.html.
     * Unknown /api paths keep returning JSON 404s so the client can tell a
     * missing record from a missing page.
     */
    app.setNotFoundHandler((request, reply) => {
      if (request.method !== 'GET' || request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'Not found' });
      }
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    });

    app.log.info(`Serving the web app from ${config.frontendDist}`);
  } else {
    app.get('/', async () => ({
      name: 'boozie-archive-api',
      docs: '/api/health',
      tracks: library.snapshot.tracks.length,
      frontend: config.serveFrontend
        ? `not built — run "npm --prefix frontend install && npm --prefix frontend run build", or set FRONTEND_DIST (looked in ${config.frontendDist})`
        : 'disabled (SERVE_FRONTEND=false)',
    }));
  }

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
