import fs from 'node:fs';
import fsp from 'node:fs/promises';

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { library } from '../lib/library.js';
import {
  acceptSuggestion,
  countPending,
  denySuggestion,
  getSuggestion,
  listSuggestions,
  quarantinePath,
  type SuggestionStatus,
} from '../lib/suggestions.js';
import { getSettings, setAnnouncement, setMaintenance } from '../lib/settings.js';
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

  // ------------------------------------------------------ site settings

  app.get('/admin/settings', async () => ({
    settings: getSettings(),
    pendingSuggestions: await countPending(),
  }));

  /**
   * Maintenance mode. Admins keep full access while it is on — otherwise the
   * person who enabled it could not turn it off again.
   */
  app.put('/admin/settings/maintenance', async (request, reply) => {
    const body = (request.body ?? {}) as { enabled?: boolean; message?: string };
    if (typeof body.enabled !== 'boolean') {
      return reply.code(400).send({ error: 'Expected { enabled: boolean }' });
    }
    const settings = await setMaintenance(
      { enabled: body.enabled, message: body.message },
      request.user!.id,
    );
    request.log.info(
      `Maintenance mode ${body.enabled ? 'ENABLED' : 'disabled'} by ${request.user!.username}`,
    );
    return { settings };
  });

  app.put('/admin/settings/announcement', async (request, reply) => {
    const body = (request.body ?? {}) as { enabled?: boolean; message?: string };
    if (typeof body.enabled !== 'boolean') {
      return reply.code(400).send({ error: 'Expected { enabled: boolean, message: string }' });
    }
    const settings = await setAnnouncement(
      { enabled: body.enabled, message: String(body.message ?? '') },
      request.user!.id,
    );
    return { settings };
  });

  // -------------------------------------------------- suggestion review

  app.get('/admin/suggestions', async (request) => {
    const { status } = request.query as { status?: string };
    const valid = ['pending', 'accepted', 'denied'];
    return {
      suggestions: await listSuggestions(
        valid.includes(status ?? '') ? (status as SuggestionStatus) : undefined,
      ),
    };
  });

  /**
   * Streams a quarantined upload so an admin can listen before deciding. The
   * file is still outside MUSIC_ROOT — this route is the only way to reach it,
   * and it is admin-only.
   */
  app.get('/admin/suggestions/:id/file', async (request, reply) => {
    const { id } = request.params as { id: string };
    const suggestion = await getSuggestion(id);
    if (!suggestion?.storedFile) return reply.code(404).send({ error: 'No file for that suggestion' });

    const file = quarantinePath(suggestion.storedFile);
    if (!file) return reply.code(404).send({ error: 'No file for that suggestion' });

    let stat: fs.Stats;
    try {
      stat = await fsp.stat(file);
    } catch {
      return reply.code(410).send({ error: 'That upload is no longer on disk' });
    }

    const range = request.headers.range;
    const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;

    reply
      .header('Content-Type', suggestion.mime ?? 'application/octet-stream')
      .header('Accept-Ranges', 'bytes')
      .header('Cache-Control', 'no-store')
      .header('X-Content-Type-Options', 'nosniff');

    if (match) {
      const start = match[1] ? Number.parseInt(match[1], 10) : 0;
      const end = match[2] ? Math.min(Number.parseInt(match[2], 10), stat.size - 1) : stat.size - 1;
      if (start > end || start >= stat.size) {
        return reply.code(416).header('Content-Range', `bytes */${stat.size}`).send();
      }
      return reply
        .code(206)
        .header('Content-Range', `bytes ${start}-${end}/${stat.size}`)
        .header('Content-Length', end - start + 1)
        .send(fs.createReadStream(file, { start, end }));
    }

    return reply
      .header('Content-Length', stat.size)
      .send(fs.createReadStream(file));
  });

  /** Accepting a track moves it into the library and rescans in the background. */
  app.post('/admin/suggestions/:id/accept', async (request) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { note?: string };
    const suggestion = await acceptSuggestion(id, request.user!.id, body.note);

    if (suggestion.libraryPath) {
      request.log.info(`Accepted upload filed at ${suggestion.libraryPath}; rescanning`);
      library.rescan(request.log).catch((error) => {
        request.log.error({ err: error }, 'Rescan after accepting a suggestion failed');
      });
    }
    return { suggestion };
  });

  app.post('/admin/suggestions/:id/deny', async (request) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { note?: string };
    return { suggestion: await denySuggestion(id, request.user!.id, body.note) };
  });
};
