import fs from 'node:fs';
import fsp from 'node:fs/promises';

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { config } from '../config.js';
import { deleteAvatarFile, resolveAvatarFile, storeAvatar } from '../lib/avatars.js';
import {
  acceptFriendRequest,
  currentAvatarUrl,
  blockUser,
  deleteMessage,
  getProfile,
  getProfileByUsername,
  listFriendRequests,
  listFriends,
  listMessages,
  listThreads,
  markRead,
  openThread,
  pendingRequestCount,
  removeFriendship,
  searchUsers,
  sendFriendRequest,
  sendMessage,
  unblockUser,
  unreadCount,
  updateProfile,
} from '../lib/social.js';
import { canListenAlong, friendStatuses, statusFor } from '../lib/presence.js';

/**
 * Friends, profiles and direct messages.
 *
 * Every handler derives the acting user from `request.user` (set by the session
 * hook) and never from the request body, so a client cannot act as someone
 * else by sending a different id.
 */
export const socialRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // ------------------------------------------------------------- profiles

  app.get('/profile/me', async (request) => ({
    profile: await getProfile(request.user!.id, request.user!.id),
  }));

  app.patch('/profile/me', async (request) => {
    const body = (request.body ?? {}) as {
      displayName?: string | null;
      bio?: string | null;
      avatarUrl?: string | null;
      accentColor?: string | null;
    };
    return { profile: await updateProfile(request.user!.id, body) };
  });

  /**
   * Serves an uploaded picture.
   *
   * The content type comes from the stored extension (which was decided by the
   * file's magic bytes on upload), never from anything the client says, and
   * `nosniff` plus an attachment-safe disposition keep a browser from ever
   * treating it as a document.
   */
  app.get('/avatar/:file', async (request, reply) => {
    const { file } = request.params as { file: string };
    const resolved = resolveAvatarFile(file);
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
      // The filename is random and changes on every upload, so this is safe to
      // cache hard — a new picture is a new URL.
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .send(fs.createReadStream(resolved.path));
  });

  /**
   * Uploads a profile picture. The image is validated by its own magic bytes
   * rather than the declared content type, stored under a random name, and the
   * previous upload is deleted so old pictures don't pile up on the Pi.
   */
  app.post('/profile/me/avatar', async (request, reply) => {
    const file = await request.file({ limits: { fileSize: config.avatarMaxBytes, files: 1 } });
    if (!file) return reply.code(400).send({ error: 'No image was uploaded.' });

    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch {
      return reply.code(413).send({
        error: `Profile pictures must be under ${Math.round(config.avatarMaxBytes / 1024 / 1024)} MB.`,
      });
    }

    const previous = await currentAvatarUrl(request.user!.id);
    const stored = await storeAvatar(buffer);
    const { profile } = { profile: await updateProfile(request.user!.id, { avatarUrl: stored.url }) };

    // Only once the new one is safely on the account.
    await deleteAvatarFile(previous).catch(() => undefined);
    return reply.code(201).send({ profile });
  });

  app.delete('/profile/me/avatar', async (request) => {
    const previous = await currentAvatarUrl(request.user!.id);
    const profile = await updateProfile(request.user!.id, { avatarUrl: null });
    await deleteAvatarFile(previous).catch(() => undefined);
    return { profile };
  });

  app.get('/profile/:username', async (request, reply) => {
    const { username } = request.params as { username: string };
    const profile = await getProfileByUsername(request.user!.id, username);
    if (!profile) return reply.code(404).send({ error: 'No such account.' });
    // Both fields apply the owner's own settings: the status is null unless
    // they show it to someone standing where this viewer is, and the flag is
    // what decides whether the Listen together button appears at all.
    const [listeningNow, allowed] = await Promise.all([
      statusFor(request.user!.id, profile.id),
      canListenAlong(request.user!.id, profile.id),
    ]);
    return { profile: { ...profile, listeningNow, canListenAlong: allowed } };
  });

  app.get('/users/search', async (request) => {
    const { q } = request.query as { q?: string };
    return { users: await searchUsers(request.user!.id, q ?? '') };
  });

  // -------------------------------------------------------------- friends

  app.get('/friends', async (request) => {
    const [friends, requests, statuses] = await Promise.all([
      listFriends(request.user!.id),
      listFriendRequests(request.user!.id),
      friendStatuses(request.user!.id),
    ]);
    return {
      friends: friends.map((friend) => ({ ...friend, listeningNow: statuses[friend.id] ?? null })),
      ...requests,
    };
  });

  app.post('/friends/requests', async (request, reply) => {
    const body = (request.body ?? {}) as { userId?: string };
    if (!body.userId) return reply.code(400).send({ error: 'Expected { userId }' });
    return sendFriendRequest(request.user!.id, body.userId);
  });

  app.post('/friends/requests/:id/accept', async (request) => {
    const { id } = request.params as { id: string };
    return acceptFriendRequest(request.user!.id, id);
  });

  /** Declines, cancels or unfriends, depending on the current state. */
  app.delete('/friends/:userId', async (request) => {
    const { userId } = request.params as { userId: string };
    return removeFriendship(request.user!.id, userId);
  });

  app.post('/friends/:userId/block', async (request) => {
    const { userId } = request.params as { userId: string };
    return blockUser(request.user!.id, userId);
  });

  app.delete('/friends/:userId/block', async (request) => {
    const { userId } = request.params as { userId: string };
    return unblockUser(request.user!.id, userId);
  });

  // ------------------------------------------------------------- messages

  /**
   * Conversations, each carrying the other person's current track so the
   * messenger can show it beside their name without a second round trip.
   */
  app.get('/dm/threads', async (request) => {
    const [threads, statuses] = await Promise.all([
      listThreads(request.user!.id),
      friendStatuses(request.user!.id),
    ]);
    return {
      threads: threads.map((thread) => ({
        ...thread,
        friend: { ...thread.friend, listeningNow: statuses[thread.friend.id] ?? null },
      })),
    };
  });

  /** Opens (or creates) the conversation with one friend. */
  app.post('/dm/threads', async (request, reply) => {
    const body = (request.body ?? {}) as { userId?: string };
    if (!body.userId) return reply.code(400).send({ error: 'Expected { userId }' });
    const threadId = await openThread(request.user!.id, body.userId);
    return { threadId };
  });

  app.get('/dm/threads/:id/messages', async (request) => {
    const { id } = request.params as { id: string };
    const { before, limit } = request.query as { before?: string; limit?: string };
    const messages = await listMessages(
      request.user!.id,
      id,
      before,
      limit ? Number.parseInt(limit, 10) : 50,
    );
    return { messages };
  });

  app.post('/dm/threads/:id/messages', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { body?: string; attachment?: unknown };
    const message = await sendMessage(request.user!.id, id, body);
    return reply.code(201).send({ message });
  });

  app.post('/dm/threads/:id/read', async (request) => {
    const { id } = request.params as { id: string };
    return markRead(request.user!.id, id);
  });

  app.delete('/dm/messages/:id', async (request) => {
    const { id } = request.params as { id: string };
    return deleteMessage(request.user!.id, id);
  });

  /** Badge counts, polled by the nav. */
  app.get('/social/badges', async (request) => {
    const [messages, friendRequests] = await Promise.all([
      unreadCount(request.user!.id),
      pendingRequestCount(request.user!.id),
    ]);
    return { messages, friendRequests };
  });
};
