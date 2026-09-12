import { pool } from '../db/pool.js';
import { AuthError } from './auth.js';
import { artPath, resolveCatalogueItem, warmArt, type CatalogueKind } from './catalogue.js';
import { library } from './library.js';
import type { Track } from '../types.js';

/**
 * The profile showcase: featured tracks, artists and albums.
 *
 * Somebody's three ranked lists, each 3, 5 or 10 long, curated entirely by
 * hand. Picks come either from this archive — in which case they play, and
 * link into the collection — or from a public catalogue, for the very common
 * case that a favourite record simply is not on this Pi.
 *
 * Readable by any signed-in member, exactly like a bio or an avatar: a
 * showcase is a statement somebody chose to make, and hiding it would defeat
 * the point of making it.
 *
 * Every write is scoped by `user_id` as well as row id, so a leaked or guessed
 * id gets a 404 rather than access to somebody else's showcase.
 */

export type FeaturedKind = CatalogueKind;
export const FEATURED_KINDS: FeaturedKind[] = ['track', 'artist', 'album'];
export const SLOT_CHOICES = [3, 5, 10] as const;
export type SlotCount = (typeof SLOT_CHOICES)[number];

const TEXT_LIMIT = 200;

export interface FeaturedItem {
  /** Row id — what a reorder, a removal and an art upload all address. */
  id: string;
  kind: FeaturedKind;
  source: 'archive' | 'deezer';
  title: string;
  subtitle: string | null;
  /** Set while this archive still resolves the id, so the tile can link. */
  libraryId: string | null;
  /** The id to ask /api/cover for. Archive picks only. */
  coverId: string | null;
  /** The resolved track, so an archive pick can be played from the tile. */
  track: Track | null;
  /**
   * A ready-made same-origin path for the artwork, already resolved through
   * the precedence below, or null when the tile should fall back to its
   * gradient placeholder. Never a remote URL.
   */
  artUrl: string | null;
  /** True when there is nothing here to open — a catalogue-only pick. */
  external: boolean;
}

export interface FeaturedList {
  slots: SlotCount;
  items: FeaturedItem[];
  /**
   * Picks beyond the current slot count. Kept rather than deleted, so
   * shrinking a list and changing your mind does not destroy the curation.
   * Only ever sent to the owner, for the editor.
   */
  hidden: FeaturedItem[];
}

export interface Showcase {
  tracks: FeaturedList;
  artists: FeaturedList;
  albums: FeaturedList;
}

interface FeaturedRow {
  id: string;
  kind: FeaturedKind;
  position: number;
  source: 'archive' | 'deezer';
  library_id: string | null;
  source_id: string | null;
  title: string;
  subtitle: string | null;
  art_ref: string | null;
  custom_art_url: string | null;
}

function slot(value: unknown): SlotCount {
  const parsed = Number(value);
  return (SLOT_CHOICES as readonly number[]).includes(parsed) ? (parsed as SlotCount) : 5;
}

export function isFeaturedKind(value: unknown): value is FeaturedKind {
  return value === 'track' || value === 'artist' || value === 'album';
}

/** Which id prefix belongs to which list, so a track can't be filed as an artist. */
const PREFIXES: Record<FeaturedKind, string> = { track: 'tr_', artist: 'ar_', album: 'al_' };

function text(value: unknown, limit = TEXT_LIMIT): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, limit) : null;
}

/**
 * Turns a row into something renderable.
 *
 * For an archive pick the live library wins, so a re-tag shows through. When
 * the id no longer resolves — a file moved, a rescan rebuilt it — the stored
 * labels carry the tile and it quietly stops being a link, rather than
 * offering a click that 404s.
 */
function toItem(row: FeaturedRow): FeaturedItem {
  let title = row.title;
  let subtitle = row.subtitle;
  let libraryId: string | null = null;
  let track: Track | null = null;

  if (row.source === 'archive' && row.library_id) {
    if (row.kind === 'track') {
      const found = library.getTrack(row.library_id);
      if (found) {
        title = found.title;
        subtitle = found.artist;
        libraryId = found.id;
        track = found;
      }
    } else if (row.kind === 'album') {
      const found = library.getAlbum(row.library_id);
      if (found) {
        title = found.name;
        subtitle = found.artistName;
        libraryId = found.id;
      }
    } else {
      const found = library.getArtist(row.library_id);
      if (found) {
        title = found.name;
        libraryId = found.id;
      }
    }
  }

  /*
   * Artwork precedence: what the owner uploaded, then what the catalogue has,
   * then the archive's own cover, then nothing (a gradient monogram).
   */
  const artUrl = row.custom_art_url ?? artPath(row.art_ref, 500);

  return {
    id: row.id,
    kind: row.kind,
    source: row.source,
    title,
    subtitle,
    libraryId,
    coverId: libraryId,
    track,
    artUrl,
    external: libraryId === null,
  };
}

// -------------------------------------------------------------------- reading

async function slotsFor(userId: string): Promise<Record<FeaturedKind, SlotCount>> {
  const { rows } = await pool.query<{
    track_slots: number;
    artist_slots: number;
    album_slots: number;
  }>(
    `SELECT COALESCE(s.track_slots, 5)  AS track_slots,
            COALESCE(s.artist_slots, 5) AS artist_slots,
            COALESCE(s.album_slots, 5)  AS album_slots
       FROM (SELECT 1) AS one
       LEFT JOIN profile_showcase s ON s.user_id = $1`,
    [userId],
  );
  const row = rows[0];
  return {
    track: slot(row?.track_slots),
    artist: slot(row?.artist_slots),
    album: slot(row?.album_slots),
  };
}

/**
 * One person's whole showcase.
 *
 * Two queries and no per-item round trips: the library lookups are against the
 * in-memory index, so a profile costs the same whether it features three
 * things or thirty.
 */
export async function getShowcase(userId: string): Promise<Showcase> {
  const [slots, { rows }] = await Promise.all([
    slotsFor(userId),
    pool.query<FeaturedRow>(
      `SELECT id, kind, position, source, library_id, source_id,
              title, subtitle, art_ref, custom_art_url
         FROM profile_featured
        WHERE user_id = $1
        ORDER BY kind, position`,
      [userId],
    ),
  ]);

  const build = (kind: FeaturedKind): FeaturedList => {
    const all = rows.filter((row) => row.kind === kind).map(toItem);
    return {
      slots: slots[kind],
      items: all.slice(0, slots[kind]),
      hidden: all.slice(slots[kind]),
    };
  };

  return { tracks: build('track'), artists: build('artist'), albums: build('album') };
}

/** The same, with the overflow stripped — what a visitor is sent. */
export function forVisitor(showcase: Showcase): Showcase {
  const strip = (list: FeaturedList): FeaturedList => ({ ...list, hidden: [] });
  return {
    tracks: strip(showcase.tracks),
    artists: strip(showcase.artists),
    albums: strip(showcase.albums),
  };
}

/** True when there is nothing to show, so a profile can omit the panel. */
export function isEmpty(showcase: Showcase): boolean {
  return (
    showcase.tracks.items.length === 0 &&
    showcase.artists.items.length === 0 &&
    showcase.albums.items.length === 0
  );
}

// -------------------------------------------------------------------- writing

/** How many picks are in one list, counting the ones currently hidden. */
async function countIn(userId: string, kind: FeaturedKind): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM profile_featured WHERE user_id = $1 AND kind = $2',
    [userId, kind],
  );
  return Number.parseInt(rows[0]?.count ?? '0', 10);
}

/**
 * Adds a pick, resolving what it is rather than believing the request.
 *
 * `{ libraryId }` features something here; `{ sourceId }` features something
 * from the catalogue, and its labels and artwork are then read from the
 * catalogue itself — a caller chooses *what* to feature, never what it claims
 * to be.
 */
export async function addFeatured(
  userId: string,
  kind: FeaturedKind,
  input: unknown,
): Promise<Showcase> {
  const body = (input ?? {}) as { libraryId?: unknown; sourceId?: unknown };

  const slots = (await slotsFor(userId))[kind];
  if ((await countIn(userId, kind)) >= slots) {
    throw new AuthError(
      `That list is full at ${slots}. Remove one, or make the list longer.`,
      409,
      'list_full',
    );
  }

  let row: {
    source: 'archive' | 'deezer';
    libraryId: string | null;
    sourceId: string | null;
    title: string;
    subtitle: string | null;
    artRef: string | null;
  };

  const libraryId = text(body.libraryId, 64);
  const sourceId = text(body.sourceId, 32);

  if (libraryId) {
    // The prefix has to match the list, and the id has to actually resolve —
    // otherwise a track id could be filed under Artists and render as a tile
    // that links nowhere.
    if (!libraryId.startsWith(PREFIXES[kind])) {
      throw new AuthError('That is not the right sort of thing for this list.', 400, 'wrong_kind');
    }
    const found =
      kind === 'track'
        ? library.getTrack(libraryId)
        : kind === 'album'
          ? library.getAlbum(libraryId)
          : library.getArtist(libraryId);
    if (!found) throw new AuthError('That is not in the archive.', 404, 'not_found');

    row = {
      source: 'archive',
      libraryId,
      sourceId: null,
      title:
        kind === 'track'
          ? (found as Track).title
          : (found as { name: string }).name,
      subtitle:
        kind === 'track'
          ? (found as Track).artist
          : kind === 'album'
            ? (found as { artistName: string }).artistName
            : null,
      artRef: null,
    };
  } else if (sourceId) {
    const item = await resolveCatalogueItem(kind, sourceId);
    row = {
      source: 'deezer',
      libraryId: null,
      sourceId: item.sourceId,
      title: item.title,
      subtitle: item.subtitle,
      artRef: item.artRef,
    };
  } else {
    throw new AuthError('Nothing to add.', 400, 'invalid_item');
  }

  try {
    await pool.query(
      `INSERT INTO profile_featured
         (user_id, kind, position, source, library_id, source_id, title, subtitle, art_ref)
       VALUES ($1, $2,
               COALESCE((SELECT max(position) + 1 FROM profile_featured
                          WHERE user_id = $1 AND kind = $2), 1),
               $3, $4, $5, $6, $7, $8)`,
      [userId, kind, row.source, row.libraryId, row.sourceId, row.title, row.subtitle, row.artRef],
    );
  } catch (error) {
    // 23505 is the partial unique index on (user, kind, id) doing its job.
    if ((error as { code?: string }).code === '23505') {
      throw new AuthError('That is already in this list.', 409, 'duplicate');
    }
    throw error;
  }

  // Pull the artwork in now, so whoever opens the profile first isn't the one
  // waiting on the catalogue.
  warmArt(row.artRef);

  await touch(userId);
  return getShowcase(userId);
}

export async function removeFeatured(userId: string, itemId: string): Promise<Showcase> {
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) {
    throw new AuthError('No such featured item.', 404, 'not_found');
  }

  const { rows } = await pool.query<{ kind: FeaturedKind; custom_art_url: string | null }>(
    `DELETE FROM profile_featured
      WHERE id = $1 AND user_id = $2
      RETURNING kind, custom_art_url`,
    [itemId, userId],
  );
  const removed = rows[0];
  // Scoped by user_id, so somebody else's item is indistinguishable from one
  // that never existed.
  if (!removed) throw new AuthError('No such featured item.', 404, 'not_found');

  await renumber(userId, removed.kind);
  await touch(userId);
  return getShowcase(userId);
}

/**
 * Puts one list in a given order.
 *
 * The whole list is sent rather than a from/to pair: it makes the write
 * idempotent and means a client that has drifted cannot half-apply a move. The
 * id set must match the list exactly, so a partial or foreign list is refused
 * rather than silently leaving rows behind.
 */
export async function reorderFeatured(
  userId: string,
  kind: FeaturedKind,
  rawIds: unknown,
): Promise<Showcase> {
  const ids = Array.isArray(rawIds)
    ? rawIds.filter((id): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id))
    : [];

  const { rows } = await pool.query<{ id: string }>(
    'SELECT id FROM profile_featured WHERE user_id = $1 AND kind = $2',
    [userId, kind],
  );
  const owned = new Set(rows.map((row) => row.id));

  if (ids.length !== owned.size || ids.some((id) => !owned.has(id))) {
    throw new AuthError('That ordering does not match the list.', 400, 'bad_order');
  }
  if (new Set(ids).size !== ids.length) {
    throw new AuthError('That ordering repeats an item.', 400, 'bad_order');
  }

  await writeOrder(userId, kind, ids);
  await touch(userId);
  return getShowcase(userId);
}

/** Moves one item by one place, which is what the arrow buttons send. */
export async function moveFeatured(
  userId: string,
  itemId: string,
  to: number,
): Promise<Showcase> {
  const { rows } = await pool.query<{ id: string; kind: FeaturedKind }>(
    `SELECT id, kind FROM profile_featured
      WHERE user_id = $1
        AND kind = (SELECT kind FROM profile_featured WHERE id = $2 AND user_id = $1)
      ORDER BY position`,
    [userId, /^[0-9a-f-]{36}$/i.test(itemId) ? itemId : '00000000-0000-0000-0000-000000000000'],
  );
  if (rows.length === 0) throw new AuthError('No such featured item.', 404, 'not_found');

  const order = rows.map((row) => row.id);
  const from = order.indexOf(itemId);
  if (from === -1) throw new AuthError('No such featured item.', 404, 'not_found');

  const target = Math.min(Math.max(Math.trunc(to), 0), order.length - 1);
  order.splice(target, 0, ...order.splice(from, 1));

  await writeOrder(userId, rows[0]!.kind, order);
  await touch(userId);
  return getShowcase(userId);
}

/**
 * Writes a whole list's positions in one statement.
 *
 * The same `unnest(... ) WITH ORDINALITY` trick playlist reordering uses, and
 * the reason the ordering index is not unique: this rewrites every row's
 * position at once, which a unique constraint would trip on part way through.
 */
async function writeOrder(userId: string, kind: FeaturedKind, order: string[]) {
  if (order.length === 0) return;
  await pool.query(
    `UPDATE profile_featured AS f
        SET position = o.position
       FROM unnest($3::uuid[]) WITH ORDINALITY AS o(id, position)
      WHERE f.user_id = $1 AND f.kind = $2 AND f.id = o.id`,
    [userId, kind, order],
  );
}

/** Closes the gap a removal leaves, so positions stay 1..n. */
async function renumber(userId: string, kind: FeaturedKind) {
  const { rows } = await pool.query<{ id: string }>(
    'SELECT id FROM profile_featured WHERE user_id = $1 AND kind = $2 ORDER BY position',
    [userId, kind],
  );
  await writeOrder(
    userId,
    kind,
    rows.map((row) => row.id),
  );
}

// ------------------------------------------------------------------ artwork

/**
 * Points an item at a new uploaded image, returning the one it replaced.
 *
 * The caller stores the new file first and unlinks the old one only after this
 * succeeds, so a failed write never leaves an item with no artwork at all.
 */
export async function setFeaturedArt(
  userId: string,
  itemId: string,
  url: string | null,
): Promise<{ showcase: Showcase; previousArtUrl: string | null }> {
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) {
    throw new AuthError('No such featured item.', 404, 'not_found');
  }

  const { rows: before } = await pool.query<{ custom_art_url: string | null }>(
    'SELECT custom_art_url FROM profile_featured WHERE id = $1 AND user_id = $2',
    [itemId, userId],
  );
  if (!before[0]) throw new AuthError('No such featured item.', 404, 'not_found');

  await pool.query(
    'UPDATE profile_featured SET custom_art_url = $3 WHERE id = $1 AND user_id = $2',
    [itemId, userId, url],
  );

  await touch(userId);
  return { showcase: await getShowcase(userId), previousArtUrl: before[0].custom_art_url };
}

// ----------------------------------------------------------------- settings

/**
 * Changes how many of each to show.
 *
 * Shrinking never deletes: the extra picks stop being shown and come back if
 * the list is made longer again. Losing a carefully ordered ten because you
 * wanted to see how three looked would be its own small tragedy.
 */
export async function setSlots(userId: string, input: unknown): Promise<Showcase> {
  const body = (input ?? {}) as Record<string, unknown>;

  const asSlot = (value: unknown, field: string): number | null => {
    if (value === undefined) return null;
    const parsed = Number(value);
    if (!(SLOT_CHOICES as readonly number[]).includes(parsed)) {
      throw new AuthError(`${field} must be 3, 5 or 10.`, 400, 'invalid_slots');
    }
    return parsed;
  };

  const track = asSlot(body.trackSlots, 'Tracks');
  const artist = asSlot(body.artistSlots, 'Artists');
  const album = asSlot(body.albumSlots, 'Albums');

  await pool.query(
    `INSERT INTO profile_showcase (user_id, track_slots, artist_slots, album_slots)
     VALUES ($1, COALESCE($2, 5), COALESCE($3, 5), COALESCE($4, 5))
     ON CONFLICT (user_id) DO UPDATE SET
       track_slots  = COALESCE($2, profile_showcase.track_slots),
       artist_slots = COALESCE($3, profile_showcase.artist_slots),
       album_slots  = COALESCE($4, profile_showcase.album_slots),
       updated_at   = now()`,
    [userId, track, artist, album],
  );

  return getShowcase(userId);
}

async function touch(userId: string) {
  await pool.query(
    `INSERT INTO profile_showcase (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO UPDATE SET updated_at = now()`,
    [userId],
  );
}
