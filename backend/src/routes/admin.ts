import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import {
  createInvite,
  deleteInvite,
  deleteUser,
  listInvites,
  listUsers,
  setInviteDisabled,
  setUserDisabled,
  setUserRole,
  type Role,
} from '../lib/auth.js';

/**
 * Admin panel API. Every route here is behind the `admin` guard registered in
 * index.ts, so reaching a handler already means the caller is a signed-in admin.
 */
export const adminRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // ------------------------------------------------------------- invites

  app.get('/admin/invites', async () => ({ invites: await listInvites() }));

  app.post('/admin/invites', async (request, reply) => {
    const body = (request.body ?? {}) as {
      label?: string;
      expiresInSeconds?: number | null;
      maxUses?: number | null;
    };

    const invite = await createInvite({
      createdBy: request.user!.id,
      label: body.label ?? null,
      expiresInSeconds:
        body.expiresInSeconds === null || body.expiresInSeconds === undefined
          ? null
          : Number(body.expiresInSeconds),
      maxUses:
        body.maxUses === null || body.maxUses === undefined ? null : Number(body.maxUses),
    });

    return reply.code(201).send({ invite });
  });

  /** Enable/disable a code without deleting it — reversible at any time. */
  app.patch('/admin/invites/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { disabled?: boolean };
    if (typeof body.disabled !== 'boolean') {
      return reply.code(400).send({ error: 'Expected { disabled: boolean }' });
    }

    const invite = await setInviteDisabled(id, body.disabled);
    if (!invite) return reply.code(404).send({ error: 'Invite not found' });
    return { invite };
  });

  app.delete('/admin/invites/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const removed = await deleteInvite(id);
    if (!removed) return reply.code(404).send({ error: 'Invite not found' });
    return { ok: true };
  });

  // --------------------------------------------------------------- users

  app.get('/admin/users', async () => ({ users: await listUsers() }));

  app.patch('/admin/users/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { role?: Role; disabled?: boolean };

    // Guard against an admin locking themselves out mid-session.
    if (id === request.user!.id && (body.role === 'user' || body.disabled === true)) {
      return reply.code(400).send({ error: "You can't demote or disable your own account." });
    }

    let user = null;
    if (body.role === 'user' || body.role === 'admin') user = await setUserRole(id, body.role);
    if (typeof body.disabled === 'boolean') user = await setUserDisabled(id, body.disabled);
    if (!user) return reply.code(404).send({ error: 'User not found' });

    return { user };
  });

  app.delete('/admin/users/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (id === request.user!.id) {
      return reply.code(400).send({ error: "You can't delete your own account." });
    }
    const removed = await deleteUser(id);
    if (!removed) return reply.code(404).send({ error: 'User not found' });
    return { ok: true };
  });
};
