import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import {
  acceptFriendRequest,
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

  app.get('/profile/:username', async (request, reply) => {
    const { username } = request.params as { username: string };
    const profile = await getProfileByUsername(request.user!.id, username);
    if (!profile) return reply.code(404).send({ error: 'No such account.' });
    return { profile };
  });

  app.get('/users/search', async (request) => {
    const { q } = request.query as { q?: string };
    return { users: await searchUsers(request.user!.id, q ?? '') };
  });

  // -------------------------------------------------------------- friends

  app.get('/friends', async (request) => {
    const [friends, requests] = await Promise.all([
      listFriends(request.user!.id),
      listFriendRequests(request.user!.id),
    ]);
    return { friends, ...requests };
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

  app.get('/dm/threads', async (request) => ({ threads: await listThreads(request.user!.id) }));

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
