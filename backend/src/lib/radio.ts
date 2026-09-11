import dns from 'node:dns/promises';
import net from 'node:net';

import { pool } from '../db/pool.js';
import { AuthError } from './auth.js';

/**
 * Internet radio.
 *
 * A station is a URL that answers with audio forever: no length, no duration,
 * no byte ranges, nothing to seek. Everything here exists to turn one of those
 * into something the rest of the app can treat like a track.
 *
 * Deliberately *not* implemented: ICY metadata. An Icecast server will
 * interleave the current song title into the audio every `icy-metaint` bytes,
 * but only if the client asks for it with an `Icy-MetaData: 1` header. We never
 * ask, so the bytes that come back are clean audio a browser can play as-is.
 * The station name is what gets shown, which is the whole intent.
 */

export interface Station {
  id: string;
  name: string;
  streamUrl: string;
  homepageUrl: string | null;
  faviconUrl: string | null;
  /** Artwork an admin uploaded, which wins over the directory's favicon. */
  coverUrl: string | null;
  codec: string | null;
  bitrate: number | null;
  country: string | null;
  tags: string[];
  sortOrder: number;
  disabled: boolean;
  createdAt: string;
}

interface StationRow {
  id: string;
  name: string;
  stream_url: string;
  homepage_url: string | null;
  favicon_url: string | null;
  cover_url: string | null;
  codec: string | null;
  bitrate: number | null;
  country: string | null;
  tags: string[];
  sort_order: number;
  disabled: boolean;
  created_at: Date;
}

const NAME_LIMIT = 80;
const PROBE_TIMEOUT_MS = 8000;
/** Enough to see the container's magic bytes without pulling real audio. */
const PROBE_BYTES = 8192;

const USER_AGENT = 'BoozieArchive/1.0 (+self-hosted personal music archive)';

/**
 * Public ids carry an `rd_` prefix.
 *
 * Every id in this app is two letters and an underscore, and both the presence
 * heartbeat and the play log validate that shape. Giving stations the same
 * shape means one flows through the status pipeline untouched, while the prefix
 * is what tells the player "this is live — no seeking, no scrobbling".
 */
export function publicId(uuid: string): string {
  return `rd_${uuid.replace(/-/g, '')}`;
}

/** The reverse. Returns null for anything that is not one of our ids. */
export function parseId(id: string): string | null {
  const match = /^rd_([0-9a-f]{32})$/i.exec(id);
  if (!match) return null;
  const hex = match[1]!;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function toStation(row: StationRow): Station {
  return {
    id: publicId(row.id),
    name: row.name,
    streamUrl: row.stream_url,
    homepageUrl: row.homepage_url,
    faviconUrl: row.favicon_url,
    coverUrl: row.cover_url,
    codec: row.codec,
    bitrate: row.bitrate,
    country: row.country,
    tags: row.tags ?? [],
    sortOrder: row.sort_order,
    disabled: row.disabled,
    createdAt: row.created_at.toISOString(),
  };
}

// ------------------------------------------------------------------ safety

/**
 * Is this address one the server should never be talked into fetching?
 *
 * Covers loopback, the private ranges, link-local (including the cloud
 * metadata address), carrier NAT and multicast, in both v4 and v6.
 */
function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a = 0, b = 0] = address.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true; // multicast and reserved
    return false;
  }

  if (net.isIPv6(address)) {
    const value = address.toLowerCase();
    if (value === '::' || value === '::1') return true;
    if (value.startsWith('fc') || value.startsWith('fd')) return true; // unique local
    if (value.startsWith('fe8') || value.startsWith('fe9')) return true; // link local
    if (value.startsWith('fea') || value.startsWith('feb')) return true;
    if (value.startsWith('ff')) return true; // multicast
    // ::ffff:10.0.0.1 and friends — judge the embedded v4 address instead.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return false;
  }

  return true;
}

/**
 * Refuses anything that is not a public http(s) URL.
 *
 * Only an admin can add a station, but the *proxy* is reachable by every
 * signed-in account, so this runs when a station is stored and again on every
 * play. A stored URL whose DNS later moves to a private address is caught by
 * the second check rather than the first.
 */
export async function assertSafeUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new AuthError('That is not a valid URL.', 400, 'invalid_stream');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AuthError('A stream URL must start with http:// or https://', 400, 'invalid_stream');
  }

  const literal = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(literal)) {
    if (isPrivateAddress(literal)) {
      throw new AuthError('That address is not reachable from here.', 400, 'invalid_stream');
    }
    return url;
  }

  let addresses: { address: string }[];
  try {
    addresses = await dns.lookup(url.hostname, { all: true });
  } catch {
    throw new AuthError('That host could not be found.', 400, 'invalid_stream');
  }

  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new AuthError('That address is not reachable from here.', 400, 'invalid_stream');
  }

  return url;
}

// ------------------------------------------------------------------- probe

export interface Probe {
  /** Where the stream really lives, after any redirects. */
  streamUrl: string;
  name: string | null;
  codec: string | null;
  bitrate: number | null;
  contentType: string;
}

const AUDIO_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/aac',
  'audio/aacp',
  'audio/mp4',
  'audio/ogg',
  'application/ogg',
  'audio/x-mpegurl',
  'audio/mpegurl',
  'audio/x-scpls',
  'text/plain',
];

/** Container sniffing, so a server that lies about Content-Type is still caught. */
function sniffCodec(bytes: Buffer): string | null {
  if (bytes.length < 4) return null;
  if (bytes.subarray(0, 3).toString('ascii') === 'ID3') return 'MP3';
  if (bytes.subarray(0, 4).toString('ascii') === 'OggS') return 'OGG';
  if (bytes[0] === 0xff) {
    // ADTS AAC and MPEG audio share the same sync word; bit 4 tells them apart.
    if (bytes[1] === 0xf1 || bytes[1] === 0xf9) return 'AAC';
    if ((bytes[1]! & 0xe0) === 0xe0) return 'MP3';
  }
  return null;
}

/** Pulls the first URL out of a .pls or .m3u playlist file. */
function firstUrlInPlaylist(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    // .pls lines look like `File1=http://...`
    const value = /^File\d*\s*=\s*(.+)$/i.exec(trimmed)?.[1] ?? trimmed;
    if (/^https?:\/\//i.test(value)) return value;
  }
  return null;
}

/**
 * Opens a stream just far enough to describe it, then hangs up.
 *
 * Redirects have to be followed: both of the Willy URLs a directory will hand
 * you are 301s, and the address a station publishes is rarely the one serving
 * the audio. A URL that turns out to be a `.pls` or `.m3u` playlist is followed
 * one level too, since that is what most "listen" links actually point at.
 */
export async function probe(raw: string, depth = 0): Promise<Probe> {
  const url = await assertSafeUrl(raw);

  let response: Response;
  try {
    response = await fetch(url, {
      // Deliberately no `Icy-MetaData` header — see the note at the top.
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch {
    throw new AuthError('Could not reach that stream.', 502, 'stream_unreachable');
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new AuthError(`That stream answered ${response.status}.`, 502, 'stream_unreachable');
  }

  const contentType = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  const head = await readSome(response, PROBE_BYTES);

  if (contentType.includes('mpegurl') && head.subarray(0, 7).toString('ascii') === '#EXTM3U') {
    // An HLS playlist rather than a shoutcast one — Chrome and Firefox can't
    // play these without a JS player, so it is refused rather than half-added.
    throw new AuthError(
      'That is an HLS stream (.m3u8), which most browsers cannot play. Look for an MP3 or AAC URL instead.',
      400,
      'unsupported_stream',
    );
  }

  // A playlist file pointing at the real stream.
  const looksLikePlaylist =
    contentType === 'text/plain' ||
    contentType === 'audio/x-scpls' ||
    contentType.includes('mpegurl') ||
    /\.(pls|m3u)(\?|$)/i.test(url.pathname);
  if (looksLikePlaylist && sniffCodec(head) === null) {
    if (depth >= 2) throw new AuthError('That playlist does not lead to a stream.', 400, 'invalid_stream');
    const next = firstUrlInPlaylist(head.toString('utf8'));
    if (!next) throw new AuthError('That playlist has no stream URL in it.', 400, 'invalid_stream');
    return probe(next, depth + 1);
  }

  const codec = sniffCodec(head);
  if (!AUDIO_TYPES.includes(contentType) && !codec) {
    throw new AuthError(
      `That URL answered with ${contentType || 'no content type'}, not audio.`,
      400,
      'invalid_stream',
    );
  }

  const bitrate = Number.parseInt(response.headers.get('icy-br') ?? '', 10);
  const name = response.headers.get('icy-name')?.trim() || null;

  return {
    // `response.url` is where we ended up, which is the URL worth storing.
    streamUrl: response.url || url.toString(),
    name: name && name.length <= NAME_LIMIT ? name : name?.slice(0, NAME_LIMIT) ?? null,
    codec: codec ?? codecFromType(contentType),
    bitrate: Number.isFinite(bitrate) && bitrate > 0 ? bitrate : null,
    contentType: contentType || 'audio/mpeg',
  };
}

function codecFromType(contentType: string): string | null {
  if (contentType.includes('mpeg') || contentType.includes('mp3')) return 'MP3';
  if (contentType.includes('aac')) return 'AAC';
  if (contentType.includes('ogg')) return 'OGG';
  return null;
}

/** Reads up to `limit` bytes, then closes the connection. */
async function readSome(response: Response, limit: number): Promise<Buffer> {
  const body = response.body;
  if (!body) return Buffer.alloc(0);

  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (total < limit) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(Buffer.from(value));
      total += value.byteLength;
    }
  } catch {
    // A stream that dies mid-probe is described by whatever arrived.
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return Buffer.concat(chunks, Math.min(total, limit));
}

// -------------------------------------------------------------------- CRUD

export async function listStations(includeDisabled = false): Promise<Station[]> {
  const { rows } = await pool.query<StationRow>(
    `SELECT * FROM radio_stations
      ${includeDisabled ? '' : 'WHERE disabled = false'}
      ORDER BY sort_order, lower(name)`,
  );
  return rows.map(toStation);
}

export async function getStation(id: string): Promise<Station | null> {
  const uuid = parseId(id);
  if (!uuid) return null;
  const { rows } = await pool.query<StationRow>('SELECT * FROM radio_stations WHERE id = $1', [uuid]);
  return rows[0] ? toStation(rows[0]) : null;
}

/** The stream URL to open, re-checked for safety on the way out. */
export async function streamUrlFor(id: string): Promise<string> {
  const station = await getStation(id);
  if (!station || station.disabled) throw new AuthError('No such station.', 404, 'not_found');
  await assertSafeUrl(station.streamUrl);
  return station.streamUrl;
}

function name(value: unknown, fallback?: string | null): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  const chosen = trimmed || (fallback ?? '').trim();
  if (!chosen) throw new AuthError('Give the station a name.', 400, 'invalid_station');
  return chosen.slice(0, NAME_LIMIT);
}

function optionalUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString().slice(0, 500) : null;
  } catch {
    return null;
  }
}

function tags(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return [
    ...new Set(
      list
        .map((tag) => String(tag).trim().toLowerCase())
        .filter((tag) => tag.length > 0 && tag.length <= 30),
    ),
  ].slice(0, 8);
}

export interface StationInput {
  name?: unknown;
  streamUrl?: unknown;
  homepageUrl?: unknown;
  faviconUrl?: unknown;
  country?: unknown;
  tags?: unknown;
  sortOrder?: unknown;
  disabled?: unknown;
}

/**
 * Adds a station, probing it first.
 *
 * The probe is not optional: it decides the URL that actually gets stored (the
 * one after redirects), fills in the codec and bitrate, and refuses anything
 * that is not playable — which is most of what a radio directory will hand you.
 */
export async function createStation(addedBy: string, input: StationInput): Promise<Station> {
  const result = await probe(String(input.streamUrl ?? ''));

  const { rows } = await pool.query<StationRow>(
    `INSERT INTO radio_stations
       (name, stream_url, homepage_url, favicon_url, codec, bitrate, country, tags, added_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (stream_url) DO NOTHING
     RETURNING *`,
    [
      name(input.name, result.name),
      result.streamUrl,
      optionalUrl(input.homepageUrl),
      optionalUrl(input.faviconUrl),
      result.codec,
      result.bitrate,
      typeof input.country === 'string' ? input.country.trim().slice(0, 60) || null : null,
      tags(input.tags),
      addedBy,
    ],
  );

  if (!rows[0]) throw new AuthError('That station is already in the list.', 409, 'duplicate_station');
  return toStation(rows[0]);
}

export async function updateStation(id: string, input: StationInput): Promise<Station> {
  const uuid = parseId(id);
  if (!uuid) throw new AuthError('No such station.', 404, 'not_found');

  // Only re-probe when the URL is actually changing — an edit to fix a typo in
  // the name should not fail because the station happens to be down.
  let probed: Probe | null = null;
  if (typeof input.streamUrl === 'string' && input.streamUrl.trim()) {
    const { rows } = await pool.query<{ stream_url: string }>(
      'SELECT stream_url FROM radio_stations WHERE id = $1',
      [uuid],
    );
    if (rows[0] && rows[0].stream_url !== input.streamUrl.trim()) {
      probed = await probe(input.streamUrl);
    }
  }

  const { rows } = await pool.query<StationRow>(
    `UPDATE radio_stations
        SET name         = COALESCE($2, name),
            stream_url   = COALESCE($3, stream_url),
            homepage_url = CASE WHEN $4::boolean THEN $5 ELSE homepage_url END,
            favicon_url  = CASE WHEN $6::boolean THEN $7 ELSE favicon_url END,
            codec        = COALESCE($8, codec),
            bitrate      = COALESCE($9, bitrate),
            country      = CASE WHEN $10::boolean THEN $11 ELSE country END,
            tags         = COALESCE($12, tags),
            sort_order   = COALESCE($13, sort_order),
            disabled     = COALESCE($14, disabled),
            updated_at   = now()
      WHERE id = $1
      RETURNING *`,
    [
      uuid,
      input.name === undefined ? null : name(input.name),
      probed?.streamUrl ?? null,
      input.homepageUrl !== undefined,
      optionalUrl(input.homepageUrl),
      input.faviconUrl !== undefined,
      optionalUrl(input.faviconUrl),
      probed?.codec ?? null,
      probed?.bitrate ?? null,
      input.country !== undefined,
      typeof input.country === 'string' ? input.country.trim().slice(0, 60) || null : null,
      input.tags === undefined ? null : tags(input.tags),
      input.sortOrder === undefined ? null : Math.trunc(Number(input.sortOrder)) || 0,
      input.disabled === undefined ? null : input.disabled === true,
    ],
  );

  if (!rows[0]) throw new AuthError('No such station.', 404, 'not_found');
  return toStation(rows[0]);
}

/**
 * Sets or clears a station's uploaded artwork.
 *
 * Clearing falls back to the favicon the directory supplied, and then to the
 * generated tile — the same ladder the page already walks. The old file is
 * reported back so the caller can delete it once the new URL is safely stored.
 */
export async function setStationCover(id: string, coverUrl: string | null) {
  const uuid = parseId(id);
  if (!uuid) throw new AuthError('No such station.', 404, 'not_found');

  // Read the old value first: a subquery inside RETURNING would be evaluated
  // against the same statement's snapshot, which is easy to get wrong.
  const { rows: before } = await pool.query<{ cover_url: string | null }>(
    'SELECT cover_url FROM radio_stations WHERE id = $1',
    [uuid],
  );
  if (!before[0]) throw new AuthError('No such station.', 404, 'not_found');

  const { rows } = await pool.query<StationRow>(
    'UPDATE radio_stations SET cover_url = $2, updated_at = now() WHERE id = $1 RETURNING *',
    [uuid, coverUrl],
  );
  return { station: toStation(rows[0]!), previousCoverUrl: before[0].cover_url };
}

export async function deleteStation(id: string) {
  const uuid = parseId(id);
  if (!uuid) throw new AuthError('No such station.', 404, 'not_found');
  const { rowCount } = await pool.query('DELETE FROM radio_stations WHERE id = $1', [uuid]);
  if (!rowCount) throw new AuthError('No such station.', 404, 'not_found');
  return { ok: true as const };
}

// -------------------------------------------------------------- directory

export interface DirectoryResult {
  name: string;
  streamUrl: string;
  homepageUrl: string | null;
  faviconUrl: string | null;
  codec: string | null;
  bitrate: number | null;
  country: string | null;
  tags: string[];
  votes: number;
}

interface RadioBrowserStation {
  name: string;
  url_resolved: string;
  homepage: string;
  favicon: string;
  codec: string;
  bitrate: number;
  country: string;
  tags: string;
  votes: number;
  hls: number;
  lastcheckok: number;
}

const directoryCache = new Map<string, { at: number; results: DirectoryResult[] }>();
const DIRECTORY_TTL_MS = 5 * 60 * 1000;

/**
 * Searches the Radio Browser directory.
 *
 * Volunteer-run and free, so results are cached for a few minutes rather than
 * re-fetched per keystroke, and the request identifies itself as they ask.
 *
 * Two filters matter more than the rest: `url_resolved` is used instead of
 * `url` (which is often a `.pls` wrapper), and anything that failed their last
 * check, or is HLS, is dropped — a directory this size is mostly dead links.
 */
export async function searchDirectory(query: string): Promise<DirectoryResult[]> {
  const term = query.trim().slice(0, 60);
  if (term.length < 2) return [];

  const cached = directoryCache.get(term.toLowerCase());
  if (cached && Date.now() - cached.at < DIRECTORY_TTL_MS) return cached.results;

  const url = new URL('https://all.api.radio-browser.info/json/stations/search');
  url.searchParams.set('name', term);
  url.searchParams.set('limit', '40');
  url.searchParams.set('hidebroken', 'true');
  url.searchParams.set('order', 'votes');
  url.searchParams.set('reverse', 'true');

  let stations: RadioBrowserStation[];
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(String(response.status));
    stations = (await response.json()) as RadioBrowserStation[];
  } catch {
    throw new AuthError('The station directory is not answering right now.', 502, 'directory_down');
  }

  const results = stations
    .filter((station) => station.lastcheckok === 1 && station.hls === 0 && station.url_resolved)
    .filter((station) => /mp3|aac/i.test(station.codec ?? ''))
    .map((station) => ({
      name: station.name.trim().slice(0, NAME_LIMIT),
      streamUrl: station.url_resolved,
      homepageUrl: optionalUrl(station.homepage),
      faviconUrl: optionalUrl(station.favicon),
      codec: station.codec || null,
      bitrate: station.bitrate || null,
      country: station.country || null,
      tags: tags(station.tags),
      votes: station.votes ?? 0,
    }))
    .slice(0, 25);

  directoryCache.set(term.toLowerCase(), { at: Date.now(), results });
  return results;
}
