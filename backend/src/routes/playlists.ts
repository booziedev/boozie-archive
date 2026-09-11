import fs from 'node:fs';
import fsp from 'node:fs/promises';

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { deleteImageFile, maxBytesFor, resolveImageFile, storeImage } from '../lib/images.js';
import {
  addTracks,
  createPlaylist,
  deletePlaylist,
  getPlaylist,
  listEntries,
  listMembers,
  isGenerator,
  openAllWrapped,
  openWrapped,
  removeMember,
  savePlaylist,
  setCover,
  setMember,
  unsavePlaylist,
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
  /**
   * The caller's library: what they own plus what they have saved.
   * `?owner=` switches to one person's playlists, for a profile page.
   */
  app.get('/playlists', async (request) => {
    const { owner } = request.query as { owner?: string };
    return { playlists: await listPlaylists(request.user!.id, owner || undefined) };
  });

  /** Keeps somebody else's playlist in your library, or takes it back out. */
  app.put('/playlists/:id/save', async (request) => {
    const { id } = request.params as { id: string };
    return { playlist: await savePlaylist(request.user!.id, id) };
  });

  app.delete('/playlists/:id/save', async (request) => {
    const { id } = request.params as { id: string };
    return { playlist: await unsavePlaylist(request.user!.id, id) };
  });

  /**
   * The generated "your listening" lists, built on first ask and refreshed
   * when they go stale. Always the caller's own — there is no way to ask for
   * somebody else's, because the play log they come from is private.
   *
   * Declared before `/playlists/:id` so the static segment wins the match.
   */
  app.get('/playlists/wrapped', async (request) => ({
    wrapped: await openAllWrapped(request.user!.id),
  }));

  app.post('/playlists/wrapped/:generator', async (request, reply) => {
    const { generator } = request.params as { generator: string };
    const { refresh } = request.query as { refresh?: string };
    if (!isGenerator(generator)) {
      return reply.code(404).send({ error: 'No such list.', code: 'not_found' });
    }
    return openWrapped(request.user!.id, generator, refresh === '1');
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

  // ----------------------------------------------------------- members

  app.get('/playlists/:id/members', async (request) => {
    const { id } = request.params as { id: string };
    return { members: await listMembers(request.user!.id, id) };
  });

  /**
   * Invites someone, or changes what they may do. `{ role }` is 'viewer' or
   * 'collaborator'; sending it again for the same person changes their role.
   */
  app.put('/playlists/:id/members/:userId', async (request) => {
    const { id, userId } = request.params as { id: string; userId: string };
    const body = (request.body ?? {}) as { role?: unknown };
    return { members: await setMember(request.user!.id, id, userId, body.role ?? 'viewer') };
  });

  app.delete('/playlists/:id/members/:userId', async (request) => {
    const { id, userId } = request.params as { id: string; userId: string };
    return { members: await removeMember(request.user!.id, id, userId) };
  });

  // ------------------------------------------------------------- cover

  /**
   * Serves an uploaded cover.
   *
   * Open to any signed-in account rather than gated on the playlist: the file
   * name is 32 random hex characters that appear nowhere but on the playlist
   * itself, so it cannot be found without already being able to see it, and
   * checking would mean a database round trip on every thumbnail.
   */
  app.get('/playlist-cover/:file', async (request, reply) => {
    const { file } = request.params as { file: string };
    const resolved = resolveImageFile('cover', file);
    if (!resolved) return reply.code(404).send({ error: 'Not found' });

    let stat: fs.Stats;
    try {
      stat = await fsp.stat(resolved.path);
    } catch {
      return reply.code(404).send({ error: 'Not found' });
    }

    return reply
      .header('Content-Type', resolved.mime)
      .header('Content-Length', stat.size)
      .header('Content-Disposition', 'inline')
      .header('X-Content-Type-Options', 'nosniff')
      // A new cover is a new random name, so this can be cached hard.
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .send(fs.createReadStream(resolved.path));
  });

  app.post('/playlists/:id/cover', async (request, reply) => {
    const { id } = request.params as { id: string };
    const limit = maxBytesFor('cover');

    const upload = await request.file({ limits: { fileSize: limit, files: 1 } });
    if (!upload) return reply.code(400).send({ error: 'No image was uploaded.' });

    let buffer: Buffer;
    try {
      buffer = await upload.toBuffer();
    } catch {
      return reply
        .code(413)
        .send({ error: `Playlist covers must be under ${Math.round(limit / 1024 / 1024)} MB.` });
    }

    // Stored first, so a failed write never clears the cover that is there.
    const stored = await storeImage('cover', buffer);
    const { playlist, previousCoverUrl } = await setCover(request.user!.id, id, stored.url);
    await deleteImageFile(previousCoverUrl).catch(() => undefined);
    return reply.code(201).send({ playlist });
  });

  app.delete('/playlists/:id/cover', async (request) => {
    const { id } = request.params as { id: string };
    const { playlist, previousCoverUrl } = await setCover(request.user!.id, id, null);
    await deleteImageFile(previousCoverUrl).catch(() => undefined);
    return { playlist };
  });

  /** Reorder: `{ to }` is the index the track should end up at. */
  app.post('/playlists/:id/tracks/:trackId/move', async (request) => {
    const { id, trackId } = request.params as { id: string; trackId: string };
    const body = (request.body ?? {}) as { to?: unknown };
    return moveTrack(request.user!.id, id, trackId, Number(body.to));
  });
};
