import { pool } from '../db/pool.js';
import { AuthError } from './auth.js';
import { library } from './library.js';
import { friendStatusBetween } from './social.js';
import type { Track } from '../types.js';

/**
 * Playlists, and the sharing rules around them.
 *
 * Track rows keep the title and artist alongside the id for the same reason
 * the play log does: ids are derived from the file's path, so a rescan after a
 * rename would otherwise leave a playlist full of rows pointing at nothing.
 * The live library track is attached on read where the id still resolves, and
 * a row that no longer does still reads correctly — it just can't be played.
 */

export type PlaylistVisibility = 'everyone' | 'friends' | 'private';

export interface Playlist {
  id: string;
  ownerId: string;
  ownerUsername: string;
  ownerDisplayName: string | null;
  name: string;
  description: string | null;
  visibility: PlaylistVisibility;
  collaborative: boolean;
  kind: 'manual' | 'blend';
  blendWith: string | null;
  trackCount: number;
  duration: number;
  /** Cover art comes from the first track that has an album. */
  coverId: string | null;
  createdAt: string;
  updatedAt: string;
  /** What the viewer may do with it. */
  canEdit: boolean;
  isOwner: boolean;
}

export interface PlaylistEntry {
  trackId: string;
  title: string;
  artist: string;
  album: string | null;
  albumId: string | null;
  duration: number | null;
  position: number;
  addedBy: string | null;
  addedAt: string;
  /** The live library record, or null when the id no longer resolves. */
  track: Track | null;
}

const NAME_LIMIT = 80;
const DESCRIPTION_LIMIT = 300;
const MAX_TRACKS = 2000;
const ID_SHAPE = /^[a-z]{2}_[A-Za-z0-9_-]{1,60}$/;

interface PlaylistRow {
  id: string;
  owner_id: string;
  owner_username: string;
  owner_display_name: string | null;
  name: string;
  description: string | null;
  visibility: PlaylistVisibility;
  collaborative: boolean;
  kind: 'manual' | 'blend';
  blend_with: string | null;
  created_at: Date;
  updated_at: Date;
  track_count: string;
  duration: string | null;
  cover_id: string | null;
}

const SELECT = /* sql */ `
  SELECT p.*, u.username AS owner_username, u.display_name AS owner_display_name,
         (SELECT count(*) FROM playlist_tracks t WHERE t.playlist_id = p.id)::text AS track_count,
         (SELECT COALESCE(sum(t.duration), 0) FROM playlist_tracks t WHERE t.playlist_id = p.id)::text AS duration,
         (SELECT t.album_id FROM playlist_tracks t
           WHERE t.playlist_id = p.id AND t.album_id IS NOT NULL
           ORDER BY t.position LIMIT 1) AS cover_id
    FROM playlists p
    JOIN users u ON u.id = p.owner_id
`;

function toPlaylist(row: PlaylistRow, viewerId: string, canEdit: boolean): Playlist {
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerUsername: row.owner_username,
    ownerDisplayName: row.owner_display_name,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    collaborative: row.collaborative,
    kind: row.kind,
    blendWith: row.blend_with,
    trackCount: Number.parseInt(row.track_count, 10),
    duration: Number.parseFloat(row.duration ?? '0'),
    coverId: row.cover_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    canEdit,
    isOwner: row.owner_id === viewerId,
  };
}

function name(value: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) throw new AuthError('Give the playlist a name.', 400, 'invalid_playlist');
  return trimmed.slice(0, NAME_LIMIT);
}

function visibility(value: unknown): PlaylistVisibility {
  if (value === 'everyone' || value === 'friends' || value === 'private') return value;
  throw new AuthError('Unknown playlist visibility.', 400, 'invalid_playlist');
}

/** Can the viewer open it at all? */
export async function canView(viewerId: string, row: PlaylistRow): Promise<boolean> {
  if (row.owner_id === viewerId) return true;
  // A blend belongs to both people in it, whatever its visibility says.
  if (row.kind === 'blend' && row.blend_with === viewerId) return true;
  if (row.visibility === 'private') return false;
  if (row.visibility === 'everyone') return true;
  return (await friendStatusBetween(viewerId, row.owner_id)) === 'friends';
}

/**
 * Can the viewer change what is in it?
 *
 * The owner always can. Friends can when it is marked collaborative — that is
 * what the flag means. A blend is generated, so nobody edits it by hand.
 */
async function canEditRow(viewerId: string, row: PlaylistRow): Promise<boolean> {
  if (row.kind === 'blend') return false;
  if (row.owner_id === viewerId) return true;
  if (!row.collaborative) return false;
  return (await friendStatusBetween(viewerId, row.owner_id)) === 'friends';
}

/** Loads a playlist, refusing anything the viewer may not open. */
async function load(viewerId: string, playlistId: string): Promise<PlaylistRow> {
  if (!/^[0-9a-f-]{36}$/i.test(playlistId)) {
    throw new AuthError('No such playlist.', 404, 'not_found');
  }
  const { rows } = await pool.query<PlaylistRow>(`${SELECT} WHERE p.id = $1`, [playlistId]);
  const row = rows[0];
  // A playlist the viewer can't see answers the same as one that isn't there,
  // so ids can't be probed for existence.
  if (!row || !(await canView(viewerId, row))) {
    throw new AuthError('No such playlist.', 404, 'not_found');
  }
  return row;
}

export async function getPlaylist(viewerId: string, playlistId: string) {
  const row = await load(viewerId, playlistId);
  return toPlaylist(row, viewerId, await canEditRow(viewerId, row));
}

/** Everything the viewer owns, plus what their friends have shared. */
export async function listPlaylists(viewerId: string): Promise<Playlist[]> {
  const { rows } = await pool.query<PlaylistRow>(
    `${SELECT}
      LEFT JOIN friendships f
        ON least(f.requester_id, f.addressee_id) = least(p.owner_id, $1::uuid)
       AND greatest(f.requester_id, f.addressee_id) = greatest(p.owner_id, $1::uuid)
       AND f.status = 'accepted'
      WHERE p.owner_id = $1
         OR p.blend_with = $1
         OR p.visibility = 'everyone'
         OR (p.visibility = 'friends' AND f.id IS NOT NULL)
      ORDER BY p.updated_at DESC`,
    [viewerId],
  );

  return Promise.all(rows.map(async (row) => toPlaylist(row, viewerId, await canEditRow(viewerId, row))));
}

export async function createPlaylist(
  ownerId: string,
  input: { name?: unknown; description?: unknown; visibility?: unknown; collaborative?: unknown },
) {
  const { rows: mine } = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM playlists WHERE owner_id = $1 AND kind = 'manual'",
    [ownerId],
  );
  if (Number.parseInt(mine[0]?.count ?? '0', 10) >= 200) {
    throw new AuthError('That is a lot of playlists — tidy some up first.', 429, 'too_many');
  }

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO playlists (owner_id, name, description, visibility, collaborative)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      ownerId,
      name(input.name),
      typeof input.description === 'string' ? input.description.trim().slice(0, DESCRIPTION_LIMIT) || null : null,
      input.visibility === undefined ? 'friends' : visibility(input.visibility),
      input.collaborative === true,
    ],
  );
  return getPlaylist(ownerId, rows[0]!.id);
}

export async function updatePlaylist(
  viewerId: string,
  playlistId: string,
  input: { name?: unknown; description?: unknown; visibility?: unknown; collaborative?: unknown },
) {
  const row = await load(viewerId, playlistId);
  // Renaming and sharing are the owner's alone, even on a collaborative list:
  // contributors add music, they don't decide who else sees it.
  if (row.owner_id !== viewerId) {
    throw new AuthError('Only the owner can change this playlist.', 403, 'not_owner');
  }

  await pool.query(
    `UPDATE playlists
        SET name = COALESCE($2, name),
            description = CASE WHEN $3::boolean THEN $4 ELSE description END,
            visibility = COALESCE($5, visibility),
            collaborative = COALESCE($6, collaborative),
            updated_at = now()
      WHERE id = $1`,
    [
      playlistId,
      input.name === undefined ? null : name(input.name),
      input.description !== undefined,
      typeof input.description === 'string' ? input.description.trim().slice(0, DESCRIPTION_LIMIT) || null : null,
      input.visibility === undefined ? null : visibility(input.visibility),
      input.collaborative === undefined ? null : input.collaborative === true,
    ],
  );
  return getPlaylist(viewerId, playlistId);
}

export async function deletePlaylist(viewerId: string, playlistId: string) {
  const { rowCount } = await pool.query('DELETE FROM playlists WHERE id = $1 AND owner_id = $2', [
    playlistId,
    viewerId,
  ]);
  if (!rowCount) throw new AuthError('No such playlist.', 404, 'not_found');
  return { ok: true as const };
}

/** The tracks in order, each with its live library record where it resolves. */
export async function listEntries(viewerId: string, playlistId: string): Promise<PlaylistEntry[]> {
  await load(viewerId, playlistId);

  const { rows } = await pool.query<{
    track_id: string;
    title: string;
    artist: string;
    album: string | null;
    album_id: string | null;
    duration: number | null;
    position: number;
    added_by: string | null;
    added_at: Date;
  }>(
    `SELECT * FROM playlist_tracks WHERE playlist_id = $1 ORDER BY position`,
    [playlistId],
  );

  return rows.map((row) => ({
    trackId: row.track_id,
    title: row.title,
    artist: row.artist,
    album: row.album,
    albumId: row.album_id,
    duration: row.duration,
    position: row.position,
    addedBy: row.added_by,
    addedAt: row.added_at.toISOString(),
    track: library.getTrack(row.track_id) ?? null,
  }));
}

/** Requires edit rights, and returns the row so callers can read its shape. */
async function loadEditable(viewerId: string, playlistId: string): Promise<PlaylistRow> {
  const row = await load(viewerId, playlistId);
  if (!(await canEditRow(viewerId, row))) {
    throw new AuthError(
      row.kind === 'blend'
        ? 'A blend is generated from what you both play — it cannot be edited.'
        : "You don't have permission to change this playlist.",
      403,
      'not_editable',
    );
  }
  return row;
}

/**
 * Appends tracks, skipping any already present.
 *
 * Resolved against the live index rather than trusted from the client: the
 * caller sends ids, and the titles stored alongside come from the library.
 */
export async function addTracks(viewerId: string, playlistId: string, trackIds: unknown) {
  await loadEditable(viewerId, playlistId);

  const ids = (Array.isArray(trackIds) ? trackIds : [])
    .map((id) => String(id))
    .filter((id) => ID_SHAPE.test(id))
    .slice(0, 500);
  if (ids.length === 0) throw new AuthError('No tracks to add.', 400, 'invalid_tracks');

  const { rows: sizeRows } = await pool.query<{ count: string; next: string | null }>(
    `SELECT count(*)::text AS count, (max(position) + 1)::text AS next
       FROM playlist_tracks WHERE playlist_id = $1`,
    [playlistId],
  );
  const existing = Number.parseInt(sizeRows[0]?.count ?? '0', 10);
  if (existing + ids.length > MAX_TRACKS) {
    throw new AuthError(`Playlists hold up to ${MAX_TRACKS} tracks.`, 400, 'playlist_full');
  }

  let position = Number.parseInt(sizeRows[0]?.next ?? '0', 10) || 0;
  let added = 0;

  for (const id of ids) {
    const track = library.getTrack(id);
    if (!track) continue;
    const { rowCount } = await pool.query(
      `INSERT INTO playlist_tracks
         (playlist_id, track_id, title, artist, album, album_id, duration, position, added_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (playlist_id, track_id) DO NOTHING`,
      [
        playlistId,
        track.id,
        track.title,
        track.artist,
        track.album || null,
        track.albumId || null,
        track.duration,
        position,
        viewerId,
      ],
    );
    if (rowCount) {
      position += 1;
      added += 1;
    }
  }

  await touch(playlistId);
  return { added, skipped: ids.length - added };
}

export async function removeTrack(viewerId: string, playlistId: string, trackId: string) {
  await loadEditable(viewerId, playlistId);
  const { rowCount } = await pool.query(
    'DELETE FROM playlist_tracks WHERE playlist_id = $1 AND track_id = $2',
    [playlistId, trackId],
  );
  if (!rowCount) throw new AuthError('That track is not in this playlist.', 404, 'not_found');
  await renumber(playlistId);
  await touch(playlistId);
  return { ok: true as const };
}

/**
 * Moves one track to a new index.
 *
 * Positions are renumbered from scratch afterwards rather than nudged, which
 * keeps them dense and makes the operation idempotent — the cost is trivial at
 * playlist sizes and the alternative drifts over time.
 */
export async function moveTrack(
  viewerId: string,
  playlistId: string,
  trackId: string,
  to: number,
) {
  await loadEditable(viewerId, playlistId);

  const { rows } = await pool.query<{ track_id: string }>(
    'SELECT track_id FROM playlist_tracks WHERE playlist_id = $1 ORDER BY position',
    [playlistId],
  );
  const order = rows.map((row) => row.track_id);
  const from = order.indexOf(trackId);
  if (from === -1) throw new AuthError('That track is not in this playlist.', 404, 'not_found');

  const target = Math.min(Math.max(Math.trunc(to), 0), order.length - 1);
  order.splice(target, 0, ...order.splice(from, 1));

  await writeOrder(playlistId, order);
  await touch(playlistId);
  return { ok: true as const };
}

async function renumber(playlistId: string) {
  const { rows } = await pool.query<{ track_id: string }>(
    'SELECT track_id FROM playlist_tracks WHERE playlist_id = $1 ORDER BY position',
    [playlistId],
  );
  await writeOrder(playlistId, rows.map((row) => row.track_id));
}

async function writeOrder(playlistId: string, order: string[]) {
  if (order.length === 0) return;
  await pool.query(
    `UPDATE playlist_tracks AS t
        SET position = o.position
       FROM unnest($2::text[]) WITH ORDINALITY AS o(track_id, position)
      WHERE t.playlist_id = $1 AND t.track_id = o.track_id`,
    [playlistId, order],
  );
}

async function touch(playlistId: string) {
  await pool.query('UPDATE playlists SET updated_at = now() WHERE id = $1', [playlistId]);
}
