import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import {
  asRange,
  clearExternalPlays,
  connect,
  disconnect,
  externalSummary,
  getConnection,
  recentExternal,
  topExternal,
  SERVICE_LABELS,
} from '../lib/scrobbles.js';

/**
 * The scrobble bridge.
 *
 * Everything here is about the caller's own account and nobody else's. There is
 * no route to read another person's outside listening: the only part of it that
 * ever leaves this account is the now-playing status, which travels through
 * `/api/presence/live` and obeys the same visibility setting as everything else.
 */
export const scrobbleRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /** The connection, plus the labels the picker offers. */
  app.get('/scrobbles/me', async (request) => ({
    connection: await getConnection(request.user!.id),
    labels: SERVICE_LABELS,
  }));

  app.put('/scrobbles/me', async (request) => ({
    connection: await connect(request.user!.id, request.body),
  }));

  app.delete('/scrobbles/me', async (request) => disconnect(request.user!.id));

  /** Forgets the recorded plays without touching the connection. */
  app.delete('/scrobbles/plays', async (request) => clearExternalPlays(request.user!.id));

  app.get('/scrobbles/recent', async (request) => {
    const { limit } = request.query as { limit?: string };
    return { plays: await recentExternal(request.user!.id, Number(limit) || 30) };
  });

  app.get('/scrobbles/top', async (request) => {
    const { kind, range, limit } = request.query as {
      kind?: string;
      range?: string;
      limit?: string;
    };
    return {
      top: await topExternal(
        request.user!.id,
        kind === 'artist' ? 'artist' : 'track',
        asRange(range),
        Number(limit) || 10,
      ),
    };
  });

  /** Counts and tops together, for the Elsewhere panel. */
  app.get('/scrobbles/summary', async (request) => {
    const { range } = request.query as { range?: string };
    return { summary: await externalSummary(request.user!.id, asRange(range)) };
  });
};
