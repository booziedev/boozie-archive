import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import {
  addTracks,
  createPlaylist,
  deletePlaylist,
  getPlaylist,
  listEntries,
  openBlend,
  listPlaylists,
  moveTrack,
  removeTrack,
  updatePlaylist,
} from '../lib/playlists.js';

/**
 * Playlists.
 *
 * Every handler takes the acting account from `request.user` and the playlist
 * from the path; the library decides what that pair is allowed to see or
 * change, so there is nothing here to talk it out of.
 */
export const playlistRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/playlists', async (request) => ({
    playlists: await listPlaylists(request.user!.id),
  }));

  /**
   * The blend this account shares with one friend, built on first ask and
   * refreshed when it has gone stale. `?refresh=1` rebuilds it now.
   */
  app.post('/playlists/blend/:friendId', async (request) => {
    const { friendId } = request.params as { friendId: string };
    const { refresh } = request.query as { refresh?: string };
    return openBlend(request.user!.id, friendId, refresh === '1');
  });

  app.post('/playlists', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    return reply.code(201).send({ playlist: await createPlaylist(request.user!.id, body) });
  });

  /** The playlist and its tracks together — a page never wants one without the other. */
  app.get('/playlists/:id', async (request) => {
    const { id } = request.params as { id: string };
    const playlist = await getPlaylist(request.user!.id, id);
    return { playlist, entries: await listEntries(request.user!.id, id) };
  });

  app.patch('/playlists/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    return { playlist: await updatePlaylist(request.user!.id, id, body) };
  });

  app.delete('/playlists/:id', async (request) => {
    const { id } = request.params as { id: string };
    return deletePlaylist(request.user!.id, id);
  });

  /**
   * Adds tracks, reporting how many were new.
   *
   * Ids that no longer resolve in the library are skipped rather than
   * rejected, so adding a stale selection still adds the rest of it.
   */
  app.post('/playlists/:id/tracks', async (request) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { trackIds?: unknown; trackId?: unknown };
    const ids = body.trackIds ?? (body.trackId === undefined ? [] : [body.trackId]);
    const result = await addTracks(request.user!.id, id, ids);
    return { ...result, playlist: await getPlaylist(request.user!.id, id) };
  });

  app.delete('/playlists/:id/tracks/:trackId', async (request) => {
    const { id, trackId } = request.params as { id: string; trackId: string };
    return removeTrack(request.user!.id, id, trackId);
  });

  /** Reorder: `{ to }` is the index the track should end up at. */
  app.post('/playlists/:id/tracks/:trackId/move', async (request) => {
    const { id, trackId } = request.params as { id: string; trackId: string };
    const body = (request.body ?? {}) as { to?: unknown };
    return moveTrack(request.user!.id, id, trackId, Number(body.to));
  });
};
