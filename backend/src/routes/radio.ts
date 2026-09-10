import { Readable } from 'node:stream';

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { AuthError } from '../lib/auth.js';
import {
  createStation,
  deleteStation,
  listStations,
  probe,
  searchDirectory,
  streamUrlFor,
  updateStation,
} from '../lib/radio.js';

const USER_AGENT = 'BoozieArchive/1.0 (+self-hosted personal music archive)';

/** Everything past listing and playing is the admin's. */
function assertAdmin(request: { user?: { role: string } | null }) {
  if (request.user?.role !== 'admin') {
    throw new AuthError('Only an admin can change the station list.', 403, 'not_admin');
  }
}

export const radioRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /** The station list. Disabled stations are only visible to admins. */
  app.get('/radio', async (request) => ({
    stations: await listStations(request.user?.role === 'admin'),
  }));

  /**
   * The stream, relayed through this server.
   *
   * Three reasons this is a proxy rather than the station's URL handed to the
   * browser, and all three are load-bearing:
   *
   *  - the player routes audio through a Web Audio graph, and a cross-origin
   *    stream without CORS headers feeds that graph *silence* — no error, just
   *    nothing, which is the worst possible failure;
   *  - plenty of stations are http-only, and a browser refuses to load those
   *    from an https page;
   *  - the station's logs see this server, not whoever is listening.
   *
   * No range support and no caching: there is nothing to seek to, and every
   * listener wants the live edge rather than the bytes someone else got.
   */
  app.get('/radio/:id/stream', async (request, reply) => {
    const { id } = request.params as { id: string };
    const url = await streamUrlFor(id);

    // Hang up upstream the moment the listener goes away, or a closed tab
    // leaves this server pulling audio for the rest of the day.
    const controller = new AbortController();
    request.raw.on('close', () => controller.abort());

    let upstream: Response;
    try {
      upstream = await fetch(url, {
        // No `Icy-MetaData` header: asking for song titles would interleave
        // them into the audio, which the browser cannot decode.
        headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
        redirect: 'follow',
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) return reply.hijack();
      return reply.code(502).send({ error: 'That station is not responding.' });
    }

    if (!upstream.ok || !upstream.body) {
      await upstream.body?.cancel().catch(() => undefined);
      return reply.code(502).send({ error: `That station answered ${upstream.status}.` });
    }

    return reply
      .header('Content-Type', upstream.headers.get('content-type') ?? 'audio/mpeg')
      .header('Cache-Control', 'no-store')
      .header('Accept-Ranges', 'none')
      .header('X-Content-Type-Options', 'nosniff')
      .send(Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]));
  });

  // ------------------------------------------------------------- admin

  /** Opens a URL and reports what it is, without storing anything. */
  app.post('/radio/probe', async (request) => {
    assertAdmin(request);
    const body = (request.body ?? {}) as { streamUrl?: unknown };
    return { probe: await probe(String(body.streamUrl ?? '')) };
  });

  /** Searches the Radio Browser directory so a station can be added by name. */
  app.get('/radio/search', async (request) => {
    assertAdmin(request);
    const { q } = request.query as { q?: string };
    return { results: await searchDirectory(q ?? '') };
  });

  app.post('/radio', async (request, reply) => {
    assertAdmin(request);
    const station = await createStation(request.user!.id, (request.body ?? {}) as never);
    return reply.code(201).send({ station });
  });

  app.patch('/radio/:id', async (request) => {
    assertAdmin(request);
    const { id } = request.params as { id: string };
    return { station: await updateStation(id, (request.body ?? {}) as never) };
  });

  app.delete('/radio/:id', async (request) => {
    assertAdmin(request);
    const { id } = request.params as { id: string };
    return deleteStation(id);
  });
};
