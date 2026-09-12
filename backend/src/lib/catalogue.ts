import fs from 'node:fs/promises';
import path from 'node:path';

import { ALLOWED_ART_HOSTS, config } from '../config.js';
import { AuthError } from './auth.js';
import { InFlight, TtlCache } from './cache.js';
import { detectImage } from './images.js';
import { assertSafeUrl } from './radio.js';

/**
 * Music this archive does not hold.
 *
 * A profile showcase is somebody saying what they love, and what somebody
 * loves is very often not on this Pi. So picks are looked up in a public
 * catalogue — Deezer's search, which needs no key, no account and no OAuth.
 *
 * Last.fm, which this app already talks to for scrobbles, can search just as
 * well but cannot supply the pictures: it replaced every artist image in its
 * API with the same placeholder star years ago over image rights. Since "top
 * artists" is a third of the feature, that ruled it out.
 *
 * Two rules shape everything here:
 *
 *  - **A remote URL never reaches a browser.** Artwork is identified by a
 *    reference like `deezer:cover:<hash>`, and the only thing a page ever
 *    requests is a path on this server. Handing out the CDN's URL would mean
 *    every viewer of a profile announcing themselves to Deezer, which is the
 *    same reason avatars are held to an allowlist.
 *  - **Nothing in a request names a host, a path or a scheme.** The upstream
 *    URL is rebuilt here from a fixed template plus a hash and a size, both
 *    validated against a strict pattern. There is no arbitrary-URL fetch for
 *    anyone to point somewhere interesting.
 */

export type CatalogueKind = 'track' | 'artist' | 'album';

export interface CatalogueItem {
  source: 'deezer';
  /** The catalogue's own id, so a pick can be re-resolved later. */
  sourceId: string;
  kind: CatalogueKind;
  title: string;
  subtitle: string | null;
  /** `deezer:artist:<hash>` or `deezer:cover:<hash>`, never a URL. */
  artRef: string | null;
}

const USER_AGENT = 'BoozieArchive/1.0 (+self-hosted personal music archive)';
const FETCH_TIMEOUT_MS = 8000;
const ART_TIMEOUT_MS = 8000;
/** Largest artwork accepted. The biggest legitimate size is ~130 KB. */
const ART_MAX_BYTES = 3 * 1024 * 1024;

/**
 * Artwork sizes the CDN will serve.
 *
 * Verified against the live service: the size appears twice in the path and
 * each of these returns a real JPEG. Requests are snapped to the nearest, so
 * the cache holds a handful of sizes rather than one per caller's whim.
 */
const ART_SIZES = [56, 120, 250, 500, 1000] as const;

const searchCache = new TtlCache<CatalogueItem[]>(10 * 60_000, 300);
const itemCache = new TtlCache<CatalogueItem>(60 * 60_000, 500);
const searchInFlight = new InFlight<CatalogueItem[]>();
const artInFlight = new InFlight<ResolvedArt | null>();

// ------------------------------------------------------------------ art refs

/** The two kinds of image the catalogue has: a person, and a sleeve. */
const ART_TYPES = new Set(['artist', 'cover']);

export function parseArtRef(ref: string): { type: string; hash: string } | null {
  const match = /^deezer:(artist|cover):([a-f0-9]{32})$/.exec(ref);
  return match ? { type: match[1]!, hash: match[2]! } : null;
}

/**
 * Turns one of the catalogue's image URLs into a reference.
 *
 * Parsing rather than trusting: only a URL that matches the expected host and
 * path shape yields a reference, and anything else yields null, which shows a
 * placeholder. That way a change at the far end degrades to a missing picture
 * instead of a stored value this server would later try to fetch.
 */
export function artRefFromUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !ALLOWED_ART_HOSTS.has(url.hostname)) return null;

  const match = /^\/images\/(artist|cover)\/([a-f0-9]{32})\//.exec(url.pathname);
  return match ? `deezer:${match[1]}:${match[2]}` : null;
}

/** A reference plus a hash, for items that expose the hash directly. */
function artRefFromHash(type: 'artist' | 'cover', hash: unknown): string | null {
  return typeof hash === 'string' && /^[a-f0-9]{32}$/.test(hash) ? `deezer:${type}:${hash}` : null;
}

/** Where a browser should ask for this artwork: always a path on this server. */
export function artPath(ref: string | null, size = 500): string | null {
  if (!ref) return null;
  const parsed = parseArtRef(ref);
  if (!parsed) return null;
  return `/api/art/deezer/${parsed.type}/${parsed.hash}/${snapSize(size)}.jpg`;
}

/** Rounds a wanted size up to one the CDN serves, for building a path. */
export function snapSize(requested: number | undefined): number {
  if (!requested || !Number.isFinite(requested)) return 500;
  for (const size of ART_SIZES) if (requested <= size) return size;
  return ART_SIZES[ART_SIZES.length - 1]!;
}

/**
 * True only for a size this feature actually serves.
 *
 * Requests are matched exactly rather than snapped. Snapping would make
 * `/…/9999.jpg` a working alias for the 1000px image, so one picture would
 * have unlimited distinct URLs — which for something cached as immutable
 * means an unbounded number of cache entries for the same bytes. Paths are
 * only ever built by `artPath`, which emits these and nothing else.
 */
function isServedSize(size: number): boolean {
  return (ART_SIZES as readonly number[]).includes(size);
}

// -------------------------------------------------------------------- search

function text(value: unknown, limit = 200): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, limit) : null;
}

interface DeezerArtist {
  id?: unknown;
  name?: unknown;
  picture_xl?: unknown;
  nb_fan?: unknown;
}

interface DeezerAlbum {
  id?: unknown;
  title?: unknown;
  md5_image?: unknown;
  cover_xl?: unknown;
  artist?: DeezerArtist;
}

interface DeezerTrack {
  id?: unknown;
  title?: unknown;
  md5_image?: unknown;
  artist?: DeezerArtist;
  album?: DeezerAlbum;
}

function mapArtist(raw: DeezerArtist): CatalogueItem | null {
  const sourceId = text(String(raw.id ?? ''), 32);
  const title = text(raw.name);
  if (!sourceId || !title) return null;
  return {
    source: 'deezer',
    sourceId,
    kind: 'artist',
    title,
    subtitle: null,
    artRef: artRefFromUrl(raw.picture_xl),
  };
}

function mapAlbum(raw: DeezerAlbum): CatalogueItem | null {
  const sourceId = text(String(raw.id ?? ''), 32);
  const title = text(raw.title);
  if (!sourceId || !title) return null;
  return {
    source: 'deezer',
    sourceId,
    kind: 'album',
    title,
    subtitle: text(raw.artist?.name),
    // md5_image is given directly on albums and tracks; the URL is the
    // fallback for shapes that only carry one.
    artRef: artRefFromHash('cover', raw.md5_image) ?? artRefFromUrl(raw.cover_xl),
  };
}

function mapTrack(raw: DeezerTrack): CatalogueItem | null {
  const sourceId = text(String(raw.id ?? ''), 32);
  const title = text(raw.title);
  if (!sourceId || !title) return null;
  return {
    source: 'deezer',
    sourceId,
    kind: 'track',
    title,
    subtitle: text(raw.artist?.name),
    // A single with no sleeve of its own falls back to the artist's picture,
    // which is better than an empty tile.
    artRef:
      artRefFromHash('cover', raw.md5_image) ??
      artRefFromHash('cover', raw.album?.md5_image) ??
      artRefFromUrl(raw.album?.cover_xl) ??
      artRefFromUrl(raw.artist?.picture_xl),
  };
}

async function fetchJson(url: URL): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new AuthError('The music catalogue is not answering right now.', 502, 'catalogue_down');
  }
  if (!response.ok) {
    throw new AuthError('The music catalogue is not answering right now.', 502, 'catalogue_down');
  }
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new AuthError('The music catalogue sent something unreadable.', 502, 'catalogue_down');
  }
}

/**
 * Searches the catalogue for one kind of thing.
 *
 * Cached for ten minutes and deduplicated while in flight, so a room full of
 * people typing the same band name is one request. Deezer asks for no key and
 * sets no quota, which makes being well-behaved entirely our responsibility.
 */
export async function searchCatalogue(
  kind: CatalogueKind,
  query: string,
  limit = 20,
): Promise<CatalogueItem[]> {
  if (!config.catalogueEnabled) return [];

  const term = query.trim().slice(0, 80);
  if (term.length < 2) return [];

  const capped = Math.min(Math.max(Math.trunc(limit) || 20, 1), 40);
  const key = `${kind}:${capped}:${term.toLowerCase()}`;

  const cached = searchCache.get(key);
  if (cached) return cached;

  return searchInFlight.run(key, async () => {
    const url = new URL(`${config.catalogueApiBase}/search/${kind}`);
    url.searchParams.set('q', term);
    url.searchParams.set('limit', String(capped));

    const payload = await fetchJson(url);
    const rows = Array.isArray(payload.data) ? payload.data : [];

    const items = rows
      .map((row) =>
        kind === 'artist'
          ? mapArtist(row as DeezerArtist)
          : kind === 'album'
            ? mapAlbum(row as DeezerAlbum)
            : mapTrack(row as DeezerTrack),
      )
      .filter((item): item is CatalogueItem => item !== null);

    searchCache.set(key, items);
    for (const item of items) itemCache.set(`${item.kind}:${item.sourceId}`, item);
    return items;
  });
}

/**
 * Looks one item up by its catalogue id.
 *
 * This is what makes the add route safe to trust: the title, subtitle and
 * artwork reference stored on a pick are read from the catalogue here, never
 * taken from the request body. A client can choose *what* to feature but not
 * what it claims to be. Normally served from the cache the search just filled,
 * so a pick costs nothing extra.
 */
export async function resolveCatalogueItem(
  kind: CatalogueKind,
  sourceId: string,
): Promise<CatalogueItem> {
  if (!config.catalogueEnabled) {
    throw new AuthError('The music catalogue is switched off.', 503, 'catalogue_off');
  }
  if (!/^[0-9]{1,20}$/.test(sourceId)) {
    throw new AuthError('That is not a catalogue id.', 400, 'invalid_item');
  }

  const key = `${kind}:${sourceId}`;
  const cached = itemCache.get(key);
  if (cached) return cached;

  const payload = await fetchJson(new URL(`${config.catalogueApiBase}/${kind}/${sourceId}`));
  if (payload.error) throw new AuthError('No such item in the catalogue.', 404, 'not_found');

  const item =
    kind === 'artist'
      ? mapArtist(payload as DeezerArtist)
      : kind === 'album'
        ? mapAlbum(payload as DeezerAlbum)
        : mapTrack(payload as DeezerTrack);

  if (!item) throw new AuthError('No such item in the catalogue.', 404, 'not_found');
  itemCache.set(key, item);
  return item;
}

// ----------------------------------------------------------------- art cache

export interface ResolvedArt {
  /** Absolute path to a file that can be streamed straight to the client. */
  file: string;
  contentType: string;
}

async function mtimeOf(file: string): Promise<number | null> {
  try {
    return (await fs.stat(file)).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Serves one piece of catalogue artwork, fetching it on first request.
 *
 * `type`, `hash` and `size` are the only inputs, and each is checked against a
 * fixed set or pattern before anything happens — so the upstream URL this
 * builds can only ever be one of the catalogue's own images. Returns null for
 * anything that does not validate, and for artwork the catalogue does not
 * have, both of which the route answers as a 404 so the page falls back to its
 * placeholder.
 */
export async function resolveArt(
  type: string,
  hash: string,
  size: number,
): Promise<ResolvedArt | null> {
  if (!ART_TYPES.has(type) || !/^[a-f0-9]{32}$/.test(hash) || !isServedSize(size)) return null;

  const file = path.join(config.externalArtDir, `deezer_${type}_${hash}_${size}.jpg`);
  if ((await mtimeOf(file)) !== null) {
    // Touch it so the sweep below treats recently-viewed art as recently used.
    await fs.utimes(file, new Date(), new Date()).catch(() => undefined);
    return { file, contentType: 'image/jpeg' };
  }
  if (!config.catalogueEnabled) return null;

  return artInFlight.run(file, async () => {
    // Rebuilt here from a fixed template. Nothing from the request but the
    // validated type, hash and size appears in it.
    const upstream = `https://cdn-images.dzcdn.net/images/${type}/${hash}/${size}x${size}-000000-80-0-0.jpg`;

    let url: URL;
    try {
      // Belt and braces: the host is hardcoded above, but DNS for any host can
      // move, and this is the guard the rest of the app already uses.
      url = await assertSafeUrl(upstream);
    } catch {
      return null;
    }
    if (!ALLOWED_ART_HOSTS.has(url.hostname)) return null;

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'image/jpeg,image/*' },
        // A redirect is a refusal, not something to follow: the catalogue
        // answers an unknown hash with a redirect to a generic placeholder,
        // and following one would also be a way off the allowlisted host.
        redirect: 'manual',
        signal: AbortSignal.timeout(ART_TIMEOUT_MS),
      });
    } catch {
      return null;
    }
    if (response.status !== 200) return null;

    const declared = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > ART_MAX_BYTES) return null;

    let bytes: Buffer;
    try {
      const raw = Buffer.from(await response.arrayBuffer());
      // Content-Length is a claim; this is the measurement.
      if (raw.byteLength === 0 || raw.byteLength > ART_MAX_BYTES) return null;
      bytes = raw;
    } catch {
      return null;
    }

    // Whatever came back has to actually be an image we recognise.
    const detected = detectImage(bytes);
    if (!detected) return null;

    try {
      await fs.mkdir(config.externalArtDir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, bytes);
      await fs.rename(tmp, file);
    } catch {
      return null;
    }

    void sweepArtCache().catch(() => undefined);
    return { file, contentType: detected.mime };
  });
}

/** Pulls artwork into the cache now, so the first viewer never waits on it. */
export function warmArt(ref: string | null): void {
  if (!ref) return;
  const parsed = parseArtRef(ref);
  if (!parsed) return;
  void resolveArt(parsed.type, parsed.hash, 500).catch(() => undefined);
  void resolveArt(parsed.type, parsed.hash, 120).catch(() => undefined);
}

let sweeping = false;

/**
 * Keeps the artwork cache from growing forever.
 *
 * Unlike the album-cover cache, which can never exceed the size of the
 * collection, this one grows with every search anybody runs — each result row
 * is a thumbnail on disk. Least recently used goes first, which with the
 * `utimes` touch above means genuinely unviewed art rather than merely old.
 */
async function sweepArtCache(): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  try {
    const names = await fs.readdir(config.externalArtDir).catch(() => []);
    const files = names.filter((name) => name.endsWith('.jpg'));
    if (files.length <= config.externalArtCacheMax) return;

    const stamped = await Promise.all(
      files.map(async (name) => {
        const full = path.join(config.externalArtDir, name);
        return { full, at: (await mtimeOf(full)) ?? 0 };
      }),
    );

    // Down to 80%, so a cache sitting on the limit doesn't sweep on every write.
    stamped.sort((a, b) => a.at - b.at);
    const keep = Math.floor(config.externalArtCacheMax * 0.8);
    for (const entry of stamped.slice(0, stamped.length - keep)) {
      await fs.rm(entry.full, { force: true }).catch(() => undefined);
    }
  } finally {
    sweeping = false;
  }
}
