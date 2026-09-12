import { pool } from '../db/pool.js';
import { AuthError } from './auth.js';
import { library } from './library.js';
import type { Album, Artist, Track } from '../types.js';

/**
 * Favourites — the hearts on tracks, albums and artists.
 *
 * These used to live in the browser's localStorage, which made them per-device
 * rather than per-person: a heart on your phone was invisible on your laptop,
 * and the page had to say so out loud. Moving them here is what lets the
 * Library be somebody's library rather than one browser's bookmarks.
 *
 * Rows outlive their ids on purpose. An id that no longer resolves is dropped
 * from what gets rendered but kept in the table — a rescan that moves an id
 * should not silently throw away what somebody chose to save, and the id may
 * well come back.
 */

export type FavouriteKind = 'track' | 'album' | 'artist';

export const FAVOURITE_KINDS: FavouriteKind[] = ['track', 'album', 'artist'];

/** Which id prefix belongs to which kind, so an album can't be filed as an artist. */
const PREFIXES: Record<FavouriteKind, string> = { track: 'tr_', album: 'al_', artist: 'ar_' };

/** Largest import accepted in one request. Far past any real collection. */
const IMPORT_LIMIT = 2000;

/**
 * A saved entity, with when it was saved.
 *
 * `savedAt` rides along because the Library sorts one grid holding favourites
 * and playlists together, and each half knows its own idea of "recently". It
 * is deliberately not called `addedAt`: albums and artists already carry one
 * of those, meaning when the *file* arrived in the archive, which is a
 * different thing entirely.
 */
export type Saved<T> = T & { savedAt: string };

export interface Favourites {
  /** Bare ids, for the heart on every card to answer instantly. */
  ids: Record<FavouriteKind, string[]>;
  /** The same things resolved, for the Library grid. Newest first. */
  items: {
    tracks: Saved<Track>[];
    albums: Saved<Album>[];
    artists: Saved<Artist>[];
  };
}

export function isFavouriteKind(value: unknown): value is FavouriteKind {
  return value === 'track' || value === 'album' || value === 'artist';
}

function kindOf(value: unknown): FavouriteKind {
  if (!isFavouriteKind(value)) {
    throw new AuthError('Ask for a track, an album or an artist.', 400, 'invalid_kind');
  }
  return value;
}

/** Shape-checks an id and confirms the archive still holds it. */
function resolve(kind: FavouriteKind, id: string): Track | Album | Artist | undefined {
  if (!id.startsWith(PREFIXES[kind])) return undefined;
  if (kind === 'track') return library.getTrack(id);
  if (kind === 'album') return library.getAlbum(id);
  return library.getArtist(id);
}

interface Row {
  kind: FavouriteKind;
  item_id: string;
  created_at: Date;
}

/**
 * Everything one account has hearted, in both shapes it is needed in.
 *
 * Both come back together because the client wants both on every page — bare
 * ids so a heart anywhere can answer without a lookup, and resolved entities
 * so the Library can render a grid. Resolving costs nothing: the archive's
 * index is already in memory, so this replaces what used to be one HTTP
 * request per favourited id.
 */
export async function listFavourites(userId: string): Promise<Favourites> {
  const { rows } = await pool.query<Row>(
    `SELECT kind, item_id, created_at
       FROM favourites
      WHERE user_id = $1
      ORDER BY created_at DESC`,
    [userId],
  );

  const ids: Record<FavouriteKind, string[]> = { track: [], album: [], artist: [] };
  const items: Favourites['items'] = { tracks: [], albums: [], artists: [] };

  for (const row of rows) {
    ids[row.kind].push(row.item_id);
    const savedAt = row.created_at.toISOString();

    // Resolved per kind rather than through the shared helper, so each branch
    // keeps its own type. Anything that no longer resolves is kept in the
    // table and left out of the render — see the note at the top.
    if (row.kind === 'track') {
      const found = library.getTrack(row.item_id);
      if (found) items.tracks.push({ ...found, savedAt });
    } else if (row.kind === 'album') {
      const found = library.getAlbum(row.item_id);
      if (found) items.albums.push({ ...found, savedAt });
    } else {
      const found = library.getArtist(row.item_id);
      if (found) items.artists.push({ ...found, savedAt });
    }
  }

  return { ids, items };
}

/**
 * Hearts something.
 *
 * The id has to match the kind's prefix *and* still resolve, the same
 * discipline `addFeatured` uses for the profile showcase — otherwise an album
 * id could be filed under artists and render as a tile that leads nowhere.
 * Hearting twice is a no-op rather than an error: the end state is what was
 * asked for either way.
 */
export async function addFavourite(
  userId: string,
  rawKind: unknown,
  id: string,
): Promise<Favourites> {
  const kind = kindOf(rawKind);
  if (!resolve(kind, id)) {
    throw new AuthError('That is not in the archive.', 404, 'not_found');
  }

  await pool.query(
    `INSERT INTO favourites (user_id, kind, item_id) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [userId, kind, id],
  );
  return listFavourites(userId);
}

/** Takes the heart back off. Silent when it was not there. */
export async function removeFavourite(
  userId: string,
  rawKind: unknown,
  id: string,
): Promise<Favourites> {
  const kind = kindOf(rawKind);
  await pool.query('DELETE FROM favourites WHERE user_id = $1 AND kind = $2 AND item_id = $3', [
    userId,
    kind,
    id,
  ]);
  return listFavourites(userId);
}

export async function clearFavourites(userId: string) {
  const { rowCount } = await pool.query('DELETE FROM favourites WHERE user_id = $1', [userId]);
  return { deleted: rowCount ?? 0 };
}

/**
 * Takes in whatever a browser was holding from before favourites were kept
 * here, and folds it into the account.
 *
 * Additive, never a replacement: running it on a phone and again on a laptop
 * merges both sets rather than letting the second overwrite the first, which
 * is the behaviour somebody with two devices actually wants. `ON CONFLICT DO
 * NOTHING` plus the primary key makes a repeat run cost nothing, so the client
 * never has to be clever about whether it already ran.
 *
 * Ids that no longer resolve are skipped here rather than stored — an import
 * is a one-off, and there is no reason to carry rubbish in from a stale
 * browser.
 */
export async function importFavourites(userId: string, raw: unknown): Promise<Favourites> {
  const payload = (raw ?? {}) as Partial<Record<FavouriteKind, unknown>>;

  const pending: { kind: FavouriteKind; id: string }[] = [];
  for (const kind of FAVOURITE_KINDS) {
    const list = payload[kind];
    if (!Array.isArray(list)) continue;
    for (const value of list) {
      if (typeof value !== 'string' || !value) continue;
      if (!resolve(kind, value)) continue;
      pending.push({ kind, id: value });
      if (pending.length >= IMPORT_LIMIT) break;
    }
  }

  if (pending.length > 0) {
    await pool.query(
      `INSERT INTO favourites (user_id, kind, item_id)
       SELECT $1, entry.kind, entry.item_id
         FROM unnest($2::text[], $3::text[]) AS entry(kind, item_id)
       ON CONFLICT DO NOTHING`,
      [userId, pending.map((entry) => entry.kind), pending.map((entry) => entry.id)],
    );
  }

  return listFavourites(userId);
}
