import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { config } from '../config.js';
import { frontendBuild } from '../lib/build.js';
import { library, type SortKey } from '../lib/library.js';
import { clearCoverCache } from '../lib/covers.js';

const SORT_KEYS: SortKey[] = ['name', 'recent', 'tracks', 'year', 'duration', 'random'];

interface RawQuery {
  q?: string;
  genre?: string;
  year?: string;
  sort?: string;
  limit?: string;
  offset?: string;
  artistId?: string;
  albumId?: string;
}

function parseQuery(raw: RawQuery) {
  const year = raw.year ? Number.parseInt(raw.year, 10) : undefined;
  const limit = raw.limit ? Number.parseInt(raw.limit, 10) : undefined;
  const offset = raw.offset ? Number.parseInt(raw.offset, 10) : undefined;
  const sort = raw.sort && SORT_KEYS.includes(raw.sort as SortKey) ? (raw.sort as SortKey) : undefined;

  return {
    q: raw.q?.trim() || undefined,
    genre: raw.genre?.trim() || undefined,
    year: Number.isFinite(year) ? year : undefined,
    sort,
    limit: Number.isFinite(limit) ? limit : undefined,
    offset: Number.isFinite(offset) ? offset : undefined,
    artistId: raw.artistId?.trim() || undefined,
    albumId: raw.albumId?.trim() || undefined,
  };
}

/** JSON metadata endpoints. Everything here is served from memory. */
export const apiRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * Liveness, plus which frontend build is being served.
   *
   * The build fields are what answer "I pulled and restarted, but the page
   * hasn't changed": if `builtAt` is older than the pull, the frontend never
   * rebuilt; if it is current but the browser is loading a different bundle
   * name, the browser is holding a cached shell.
   */
  app.get('/health', async () => ({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    indexed: !library.isEmpty,
    scanning: library.progress.scanning,
    frontend: frontendBuild(),
  }));

  app.get('/stats', async () => library.stats());

  app.get('/scan/status', async () => ({
    ...library.progress,
    scannedAt: library.snapshot.scannedAt,
    tracks: library.snapshot.tracks.length,
  }));

  /**
   * Triggers a rescan. Protected by ADMIN_TOKEN; when no token is configured
   * the route is disabled entirely so a public deployment can't be hammered.
   */
  app.post('/rescan', async (request, reply) => {
    if (!config.adminToken) {
      return reply.code(404).send({ error: 'Rescan endpoint disabled (no ADMIN_TOKEN set)' });
    }
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : header;
    if (token !== config.adminToken) return reply.code(401).send({ error: 'Unauthorized' });

    if (library.progress.scanning) {
      return reply.code(202).send({ status: 'already-scanning', progress: library.progress });
    }

    const clearCovers = (request.query as { covers?: string }).covers === 'clear';
    void (async () => {
      try {
        if (clearCovers) await clearCoverCache();
        await library.rescan(app.log);
      } catch (error) {
        app.log.error({ err: error }, 'Rescan failed');
      }
    })();

    return reply.code(202).send({ status: 'scanning' });
  });

  app.get('/artists', async (request) => {
    const query = parseQuery(request.query as RawQuery);
    return library.listArtists(query);
  });

  app.get('/artists/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const artist = library.getArtist(id);
    if (!artist) return reply.code(404).send({ error: 'Artist not found' });
    return { artist, albums: library.albumsOfArtist(id) };
  });

  app.get('/artists/:id/tracks', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!library.getArtist(id)) return reply.code(404).send({ error: 'Artist not found' });
    const query = parseQuery(request.query as RawQuery);
    return library.listTracks({ ...query, artistId: id });
  });

  app.get('/albums', async (request) => {
    const query = parseQuery(request.query as RawQuery);
    return library.listAlbums(query);
  });

  app.get('/albums/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const album = library.getAlbum(id);
    if (!album) return reply.code(404).send({ error: 'Album not found' });
    return {
      album,
      artist: library.getArtist(album.artistId) ?? null,
      tracks: library.tracksOfAlbum(id),
    };
  });

  app.get('/tracks', async (request) => {
    const query = parseQuery(request.query as RawQuery);
    return library.listTracks(query);
  });

  app.get('/tracks/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const track = library.getTrack(id);
    if (!track) return reply.code(404).send({ error: 'Track not found' });
    return {
      track,
      album: library.getAlbum(track.albumId) ?? null,
      artist: library.getArtist(track.artistId) ?? null,
    };
  });

  /** Type-ahead search across all three entity types in one round trip. */
  app.get('/search', async (request) => {
    const { q, limit } = parseQuery(request.query as RawQuery);
    if (!q) return { query: '', artists: [], albums: [], tracks: [] };
    return { query: q, ...library.search(q, limit ?? 8) };
  });

  app.get('/genres', async () => library.genres());
  app.get('/years', async () => library.years());
  app.get('/recent', async (request) => {
    const { limit } = parseQuery(request.query as RawQuery);
    return library.recentAlbums(limit ?? 18);
  });

  /**
   * Whole-library snapshot. Handy for offline caching or debugging; tracks are
   * only included when explicitly requested because the payload is large.
   */
  app.get('/library', async (request) => {
    const includeTracks = (request.query as { tracks?: string }).tracks === '1';
    const snapshot = library.snapshot;
    return {
      stats: library.stats(),
      artists: snapshot.artists,
      albums: snapshot.albums,
      tracks: includeTracks ? snapshot.tracks : undefined,
      scannedAt: snapshot.scannedAt,
    };
  });
};
