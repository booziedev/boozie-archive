import fs from 'node:fs/promises';
import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';

import { config } from './config.js';
import { library } from './lib/library.js';
import { assertDatabaseReachable, closePool, runMigrations } from './db/pool.js';
import { AuthError, pruneExpiredSessions, resolveSession } from './lib/auth.js';
import { apiRoutes } from './routes/api.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes, loginThrottle } from './routes/auth.js';
import { mediaRoutes } from './routes/media.js';

/** Returns the first candidate directory that contains a built index.html. */
async function findFrontendDist(): Promise<string | null> {
  for (const dir of config.frontendDistCandidates) {
    const ok = await fs
      .stat(path.join(dir, 'index.html'))
      .then((stat) => stat.isFile())
      .catch(() => false);
    if (ok) return dir;
  }
  return null;
}

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

  await app.register(cookie);

  /**
   * With cookie auth the browser will not accept `Access-Control-Allow-Origin: *`
   * on a credentialed request, so `origin: true` reflects the caller's origin
   * instead — same permissiveness, but a form browsers accept with credentials.
   */
  const allowAnyOrigin = config.corsOrigins.includes('*');
  await app.register(cors, {
    origin: allowAnyOrigin ? true : config.corsOrigins,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
    // Browsers need these exposed for seeking and progress UI.
    exposedHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges', 'Content-Disposition'],
    maxAge: 86400,
  });

  /** Turns AuthError into its intended status code instead of a generic 500. */
  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof AuthError) {
      return reply.code(error.status).send({ error: error.message, code: error.code });
    }
    request.log.error({ err: error }, 'Request failed');
    const statusCode = (error as { statusCode?: number }).statusCode;
    const status = statusCode && statusCode >= 400 ? statusCode : 500;
    return reply.code(status).send({
      error:
        status === 500
          ? 'Something went wrong on the server.'
          : ((error as Error).message ?? 'Request failed'),
    });
  });

  /** Routes reachable without an account. Everything else needs one. */
  const PUBLIC_PATHS = new Set(['/api/health', '/api/auth/context', '/api/auth/login', '/api/auth/register', '/api/auth/logout', '/api/auth/me']);

  function isPublicPath(pathname: string): boolean {
    return PUBLIC_PATHS.has(pathname) || pathname.startsWith('/api/auth/invite/');
  }

  if (config.authEnabled) {
    app.addHook('onRequest', async (request, reply) => {
      const token = request.cookies?.[config.cookieName];
      request.user = token ? await resolveSession(token) : null;

      const pathname = request.url.split('?')[0] ?? '';

      /**
       * CSRF: a cookie-authenticated state-changing request must come from an
       * origin we serve. Same-origin browsers send no Origin header on
       * same-site form posts, and our own client always sends JSON with an
       * Origin, so requiring a *matching* Origin when one is present is enough
       * without breaking curl or the media elements.
       */
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        const origin = request.headers.origin;
        if (origin && !allowAnyOrigin && !config.corsOrigins.includes(origin)) {
          return reply.code(403).send({ error: 'Cross-origin request blocked.' });
        }
      }

      if (!pathname.startsWith('/api/')) return; // static assets and the SPA shell
      if (isPublicPath(pathname)) return;
      if (config.allowPublicBrowse && request.method === 'GET') return;

      if (!request.user) {
        return reply.code(401).send({ error: 'Sign in to browse the archive.', code: 'unauthenticated' });
      }
    });

    // Admin-only surface.
    app.addHook('onRequest', async (request, reply) => {
      if (!request.url.startsWith('/api/admin/')) return;
      if (request.user?.role !== 'admin') {
        return reply.code(403).send({ error: 'Admins only.', code: 'forbidden' });
      }
    });
  } else {
    // Keeps `request.user` defined everywhere, so routes need no special case.
    app.addHook('onRequest', async (request) => {
      request.user = null;
    });
  }

  await app.register(authRoutes, { prefix: '/api' });
  if (config.authEnabled) await app.register(adminRoutes, { prefix: '/api' });
  await app.register(apiRoutes, { prefix: '/api' });
  await app.register(mediaRoutes, { prefix: '/api' });

  /**
   * Serve the built frontend from the same process when it is present, so the
   * whole app lives behind a single port and a single tunnel. Deploying the
   * frontend to Cloudflare Pages instead still works: just don't build it here
   * (or set SERVE_FRONTEND=false) and the server stays API-only.
   */
  const frontendDist = config.serveFrontend ? await findFrontendDist() : null;

  if (frontendDist) {
    await app.register(fastifyStatic, {
      root: frontendDist,
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

    app.log.info(`Serving the web app from ${frontendDist}`);
  } else if (config.serveFrontend) {
    // Loud, actionable: this is the difference between "I get the app" and
    // "I get JSON", and the reason is always one of these two.
    app.log.error(
      'The web app is NOT being served — no build found. Run this in the repo root:\n' +
        '    npm run setup     (installs everything and builds backend + frontend)\n' +
        '  then restart the server. Directories checked:\n' +
        config.frontendDistCandidates.map((dir) => `    - ${dir}`).join('\n'),
    );

    app.get('/', async () => ({
      name: 'boozie-archive-api',
      docs: '/api/health',
      tracks: library.snapshot.tracks.length,
      frontend:
        'not found — run "npm run setup" in the repo root, then restart. ' +
        'Set FRONTEND_DIST to point at the build explicitly.',
      checked: config.frontendDistCandidates,
    }));
  } else {
    app.get('/', async () => ({
      name: 'boozie-archive-api',
      docs: '/api/health',
      tracks: library.snapshot.tracks.length,
      frontend: 'disabled (SERVE_FRONTEND=false)',
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

  if (config.authEnabled) {
    try {
      await assertDatabaseReachable();
      await runMigrations(app.log);
    } catch (error) {
      // Fail closed: starting without the database would serve the whole
      // archive with no accounts and no invite checks at all.
      app.log.fatal(
        `Cannot reach PostgreSQL at ${config.databaseUrl.replace(/:[^:@/]*@/, ':***@')}\n` +
          `  ${(error as Error).message}\n` +
          '  Diagnose it with:  npm run doctor      (from the repo root)\n' +
          '  Setup guide:       POSTGRES.md\n' +
          '  Or set AUTH_ENABLED=false in backend/.env to run without accounts.',
      );
      process.exit(1);
    }
    app.log.info('Accounts enabled — registration requires an invite code.');
  } else {
    app.log.warn('AUTH_ENABLED=false — the archive is open to anyone who can reach it.');
  }

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

  let cleanupTimer: NodeJS.Timeout | null = null;
  if (config.authEnabled) {
    cleanupTimer = setInterval(
      () => {
        loginThrottle.prune();
        pruneExpiredSessions().catch((error) =>
          app.log.warn(`Session cleanup failed: ${(error as Error).message}`),
        );
      },
      60 * 60_000,
    );
    cleanupTimer.unref();
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      app.log.info(`${signal} received, shutting down`);
      if (timer) clearInterval(timer);
      if (cleanupTimer) clearInterval(cleanupTimer);
      app
        .close()
        .then(() => (config.authEnabled ? closePool() : undefined))
        .then(
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
