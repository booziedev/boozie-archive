import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { library } from '../lib/library.js';

import {
  clearHistory,
  cleanPlay,
  playCounts,
  recap,
  recentPlays,
  recordPlay,
  topPlayed,
  type Range,
} from '../lib/history.js';

/** Only the windows the queries know how to build. */
function range(value: unknown): Range {
  return value === 'week' || value === 'month' || value === 'year' || value === 'all'
    ? value
    : 'month';
}

/** Reads `?limit=` off a request, for the handlers that take one. */
function limit(request: { query: unknown }): unknown {
  return (request.query as { limit?: string }).limit;
}

function count(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * The listening log and everything read out of it.
 *
 * A play always belongs to the session that reported it — the account comes
 * from `request.user`, never the body — so nobody can write history onto
 * somebody else's profile.
 */
export const historyRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * Records a play. The client decides when one counts (long enough to be a
   * listen rather than a skip); this only checks the shape.
   */
  app.post('/history', async (request, reply) => {
    const body = (request.body ?? {}) as { play?: unknown };
    const play = cleanPlay(body.play);
    if (!play) return reply.code(400).send({ error: 'Expected a valid { play }' });
    return reply.code(201).send({ play: await recordPlay(request.user!.id, play) });
  });

  /**
   * Recently played, each row carrying the live library track where its id
   * still resolves.
   *
   * The index is already in memory, so this costs nothing and makes the row
   * directly playable. A play whose file has since been renamed or re-tagged
   * comes back with `track: null` and still reads correctly from the labels
   * stored with it.
   */
  app.get('/history/recent', async (request) => {
    const plays = await recentPlays(request.user!.id, count(limit(request), 20));
    return {
      plays: plays.map((play) => ({ ...play, track: library.getTrack(play.trackId) ?? null })),
    };
  });

  /** Play counts for a set of tracks, so a list can show them in one round trip. */
  app.get('/history/counts', async (request) => {
    const { ids } = request.query as { ids?: string };
    const trackIds = (ids ?? '').split(',').map((id) => id.trim()).filter(Boolean);
    return { counts: await playCounts(request.user!.id, trackIds) };
  });

  app.get('/history/top', async (request) => {
    const query = request.query as { kind?: string; range?: string; limit?: string };
    const kind = query.kind === 'artist' || query.kind === 'album' ? query.kind : 'track';
    return { entries: await topPlayed(request.user!.id, kind, range(query.range), count(query.limit, 20)) };
  });

  app.get('/history/recap', async (request) => {
    const { range: window } = request.query as { range?: string };
    return { recap: await recap(request.user!.id, range(window)) };
  });

  /** Their log, their call. */
  app.delete('/history', async (request) => clearHistory(request.user!.id));
};
