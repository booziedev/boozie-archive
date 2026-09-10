import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import {
  currentParty,
  forcePauseAt,
  getParty,
  getPrivacy,
  heartbeat,
  joinParty,
  leaveParty,
  listenAlongWith,
  updatePrivacy,
  visibleStatuses,
} from '../lib/presence.js';

/**
 * "Listening now" statuses, privacy, and listen-along sessions.
 *
 * As everywhere else in the social surface, the acting account comes from
 * `request.user` and never from the body, so nobody can report a status as
 * someone else or invite on another host's behalf.
 */
export const presenceRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // ------------------------------------------------------------- presence

  /**
   * The player's heartbeat: what is loaded, where it is, and whether it is
   * running. Sending no track (or `{ }`) retracts the status — which is how
   * pressing stop, signing out or emptying the queue clears it immediately
   * instead of leaving a ghost until it expires.
   */
  app.put('/presence', async (request) => {
    const body = (request.body ?? {}) as { now?: unknown };
    return heartbeat(request.user!.id, body.now ?? null);
  });

  /**
   * Everything that changes while the app is open: who is playing what, and the
   * session this account is in.
   *
   * One request drives every status in the UI and both sides of a listen-along
   * session. Splitting them meant the friends list, the messenger and a profile
   * each refetched on their own clock — a skip took as long as the slowest of
   * them to appear — and a host only found out they had listeners on their next
   * heartbeat, twenty seconds later.
   */
  app.get('/presence/live', async (request) => {
    const [statuses, party, forcePause] = await Promise.all([
      visibleStatuses(request.user!.id),
      currentParty(request.user!.id),
      forcePauseAt(request.user!.id),
    ]);
    // `forcePause` is an admin asking this player to stop; the client compares
    // it against the last one it acted on.
    return { statuses, party, forcePauseAt: forcePause };
  });

  app.get('/presence/privacy', async (request) => getPrivacy(request.user!.id));

  app.patch('/presence/privacy', async (request) => {
    const body = (request.body ?? {}) as {
      statusVisibility?: unknown;
      allowPartyInvites?: unknown;
    };
    return updatePrivacy(request.user!.id, body);
  });

  // -------------------------------------------------------------- parties

  /** The session this account is hosting or following, for a page reload. */
  app.get('/parties/current', async (request) => ({
    party: await currentParty(request.user!.id),
  }));

  /**
   * Starts listening along with somebody, from their profile.
   *
   * Their session is created here if this is the first listener — hosting is
   * not something anyone opts into, so there is no endpoint for starting one.
   */
  app.post('/parties/listen-along', async (request, reply) => {
    const body = (request.body ?? {}) as { userId?: string };
    if (!body.userId) return reply.code(400).send({ error: 'Expected { userId }' });
    return reply.code(201).send({ party: await listenAlongWith(request.user!.id, body.userId) });
  });

  app.get('/parties/:id', async (request) => {
    const { id } = request.params as { id: string };
    return { party: await getParty(request.user!.id, id) };
  });

  app.post('/parties/:id/join', async (request) => {
    const { id } = request.params as { id: string };
    return { party: await joinParty(request.user!.id, id) };
  });

  app.post('/parties/:id/leave', async (request) => {
    const { id } = request.params as { id: string };
    return leaveParty(request.user!.id, id);
  });

};
