import fs from 'node:fs';
import fsp from 'node:fs/promises';

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { AuthError } from '../lib/auth.js';
import { artPath, resolveArt, searchCatalogue, type CatalogueItem } from '../lib/catalogue.js';
import { deleteImageFile, maxBytesFor, resolveImageFile, storeImage } from '../lib/images.js';
import { library } from '../lib/library.js';
import {
  addFeatured,
  getShowcase,
  isFeaturedKind,
  moveFeatured,
  removeFeatured,
  reorderFeatured,
  setFeaturedArt,
  setSlots,
  type FeaturedKind,
} from '../lib/showcase.js';

/**
 * The profile showcase, and the music search behind it.
 *
 * Everything that writes is about the caller's own showcase — there is no
 * route that takes a user id, so the only showcase anyone can change is their
 * own. Reading somebody else's is attached to the profile routes in
 * `social.ts`, where the profile itself is assembled.
 */

/** One result row, whether it came from here or from the catalogue. */
interface Candidate {
  source: 'archive' | 'deezer';
  /** A library id for archive results; the catalogue's id otherwise. */
  id: string;
  kind: FeaturedKind;
  title: string;
  subtitle: string | null;
  /** Same-origin path, or null for a placeholder. Never a remote URL. */
  artUrl: string | null;
}

function kindFrom(value: unknown): FeaturedKind {
  if (!isFeaturedKind(value)) {
    throw new AuthError('Ask for a track, an artist or an album.', 400, 'invalid_kind');
  }
  return value;
}

/** The archive's own hits, in the same shape as the catalogue's. */
function searchArchive(kind: FeaturedKind, query: string, limit: number): Candidate[] {
  const found = library.search(query, limit);

  if (kind === 'artist') {
    return found.artists.map((artist) => ({
      source: 'archive' as const,
      id: artist.id,
      kind,
      title: artist.name,
      subtitle: null,
      artUrl: artist.hasCover ? `/api/cover/${artist.id}?size=320` : null,
    }));
  }
  if (kind === 'album') {
    return found.albums.map((album) => ({
      source: 'archive' as const,
      id: album.id,
      kind,
      title: album.name,
      subtitle: album.artistName,
      artUrl: album.hasCover ? `/api/cover/${album.id}?size=320` : null,
    }));
  }
  return found.tracks.map((track) => ({
    source: 'archive' as const,
    id: track.id,
    kind,
    title: track.title,
    subtitle: track.artist,
    artUrl: `/api/cover/${track.id}?size=320`,
  }));
}

function toCandidate(item: CatalogueItem): Candidate {
  return {
    source: 'deezer',
    id: item.sourceId,
    kind: item.kind,
    title: item.title,
    subtitle: item.subtitle,
    // A path on this server. The picker's thumbnails go through the same cache
    // the profile tiles do, so no browser ever talks to the catalogue's CDN.
    artUrl: artPath(item.artRef, 120),
  };
}

export const showcaseRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * Search, for the picker.
   *
   * The archive's own hits come back separately and first, because a pick that
   * exists here can be played and linked while a catalogue pick can only be
   * looked at — and the whole point of the archive is the music in it.
   *
   * A catalogue outage is not an error for the whole request: `archive` still
   * answers and `catalogueError` says why the other half is empty, so the
   * picker degrades to searching this collection instead of showing nothing.
   */
  app.get('/catalogue/search', async (request) => {
    const { kind: rawKind, q, limit } = request.query as {
      kind?: string;
      q?: string;
      limit?: string;
    };
    const kind = kindFrom(rawKind);
    const query = (q ?? '').trim();
    const count = Math.min(Math.max(Number(limit) || 20, 1), 40);

    if (query.length < 2) {
      return { archive: [], catalogue: [], catalogueError: null };
    }

    const archive = searchArchive(kind, query, Math.min(count, 12));

    let catalogue: Candidate[] = [];
    let catalogueError: string | null = null;
    try {
      catalogue = (await searchCatalogue(kind, query, count)).map(toCandidate);
    } catch (error) {
      catalogueError =
        error instanceof AuthError ? error.message : 'The music catalogue is unavailable.';
    }

    return { archive, catalogue, catalogueError };
  });

  // ------------------------------------------------------------ the showcase

  app.get('/featured/me', async (request) => ({
    showcase: await getShowcase(request.user!.id),
  }));

  app.post('/featured/:kind', async (request, reply) => {
    const { kind } = request.params as { kind: string };
    const showcase = await addFeatured(request.user!.id, kindFrom(kind), request.body);
    return reply.code(201).send({ showcase });
  });

  app.delete('/featured/:itemId', async (request) => {
    const { itemId } = request.params as { itemId: string };
    return { showcase: await removeFeatured(request.user!.id, itemId) };
  });

  /** `{ ids }` is the whole list in its new order. */
  app.post('/featured/:kind/reorder', async (request) => {
    const { kind } = request.params as { kind: string };
    const body = (request.body ?? {}) as { ids?: unknown };
    return { showcase: await reorderFeatured(request.user!.id, kindFrom(kind), body.ids) };
  });

  /** `{ to }` is the index this item should end up at — what the arrows send. */
  app.post('/featured/:itemId/move', async (request) => {
    const { itemId } = request.params as { itemId: string };
    const body = (request.body ?? {}) as { to?: unknown };
    return { showcase: await moveFeatured(request.user!.id, itemId, Number(body.to)) };
  });

  app.put('/featured/slots', async (request) => ({
    showcase: await setSlots(request.user!.id, request.body),
  }));

  // -------------------------------------------------------------- their art

  app.post('/featured/:itemId/art', async (request, reply) => {
    const { itemId } = request.params as { itemId: string };
    const limit = maxBytesFor('featured');

    const upload = await request.file({ limits: { fileSize: limit, files: 1 } });
    if (!upload) return reply.code(400).send({ error: 'No image was uploaded.' });

    let buffer: Buffer;
    try {
      buffer = await upload.toBuffer();
    } catch {
      return reply
        .code(413)
        .send({ error: `Artwork must be under ${Math.round(limit / 1024 / 1024)} MB.` });
    }

    // Stored first, so a failed write never clears the art that is there.
    const stored = await storeImage('featured', buffer);
    const { showcase, previousArtUrl } = await setFeaturedArt(
      request.user!.id,
      itemId,
      stored.url,
    );
    await deleteImageFile(previousArtUrl).catch(() => undefined);
    return reply.code(201).send({ showcase });
  });

  /** Back to whatever the catalogue or the archive supplies. */
  app.delete('/featured/:itemId/art', async (request) => {
    const { itemId } = request.params as { itemId: string };
    const { showcase, previousArtUrl } = await setFeaturedArt(request.user!.id, itemId, null);
    await deleteImageFile(previousArtUrl).catch(() => undefined);
    return { showcase };
  });

  app.get('/featured-art/:file', async (request, reply) => {
    const { file } = request.params as { file: string };
    const resolved = resolveImageFile('featured', file);
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
      // A new upload is a new random name, so this can be cached hard.
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .send(fs.createReadStream(resolved.path));
  });

  // ------------------------------------------------------------ catalogue art

  /**
   * Catalogue artwork, fetched once and then served from this server.
   *
   * Deliberately addressed by path segments and nothing else: a type, a hash
   * and a size, each validated against a fixed set before anything is fetched.
   * There is no query parameter naming a URL or a host anywhere in this
   * feature, so there is no request anyone can point somewhere of their
   * choosing. Anything that fails to validate — and any image the catalogue
   * turns out not to have — is a 404, and the page falls back to its
   * placeholder.
   *
   * The point of the indirection is that a viewer's browser never talks to the
   * catalogue's CDN, so looking at somebody's profile doesn't announce you to
   * a third party.
   */
  app.get('/art/deezer/:type/:hash/:size', async (request, reply) => {
    const { type, hash, size } = request.params as {
      type: string;
      hash: string;
      size: string;
    };

    // The route is spelled `<size>.jpg` so it reads as a file to caches and
    // browsers; only the number matters here.
    const pixels = Number.parseInt(size.replace(/\.jpg$/i, ''), 10);
    const resolved = await resolveArt(type, hash, pixels);
    if (!resolved) return reply.code(404).send({ error: 'Not found' });

    let stat: fs.Stats;
    try {
      stat = await fsp.stat(resolved.file);
    } catch {
      return reply.code(404).send({ error: 'Not found' });
    }

    return reply
      .header('Content-Type', resolved.contentType)
      .header('Content-Length', stat.size)
      .header('Content-Disposition', 'inline')
      .header('X-Content-Type-Options', 'nosniff')
      // Content-addressed: this hash always means this picture.
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .send(fs.createReadStream(resolved.file));
  });
};
