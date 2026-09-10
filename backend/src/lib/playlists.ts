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

/**
 * What one invited person may do.
 *
 * A viewer can open the playlist and download it; a collaborator can also
 * change what is in it. Neither can rename it or decide who else gets in —
 * that stays with the owner.
 */
export type PlaylistRole = 'viewer' | 'collaborator';

export interface PlaylistMember {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: PlaylistRole;
  addedAt: string;
}

export interface Playlist {
  id: string;
  ownerId: string;
  ownerUsername: string;
  ownerDisplayName: string | null;
  name: string;
  description: string | null;
  visibility: PlaylistVisibility;
  kind: 'manual' | 'blend';
  blendWith: string | null;
  trackCount: number;
  duration: number;
  /** An uploaded cover, when there is one. */
  coverUrl: string | null;
  /** Otherwise cover art comes from the first track that has an album. */
  coverId: string | null;
  /** How many people have been invited, so the UI can badge the button. */
  memberCount: number;
  createdAt: string;
  updatedAt: string;
  /** What the viewer may do with it. */
  canEdit: boolean;
  isOwner: boolean;
  /** The viewer's own role, when they were invited rather than an owner. */
  role: PlaylistRole | null;
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
  kind: 'manual' | 'blend';
  blend_with: string | null;
  cover_url: string | null;
  created_at: Date;
  updated_at: Date;
  track_count: string;
  duration: string | null;
  cover_id: string | null;
  member_count: string;
  /** The asking viewer's role, resolved by the query rather than a second trip. */
  viewer_role: PlaylistRole | null;
}

/**
 * Every read of a playlist goes through this.
 *
 * `$1` is always the viewer, so the row comes back already carrying their own
 * membership — the permission checks below need it on every path, and fetching
 * it separately turned one query into two on every list.
 */
const SELECT = /* sql */ `
  SELECT p.*, u.username AS owner_username, u.display_name AS owner_display_name,
         (SELECT count(*) FROM playlist_tracks t WHERE t.playlist_id = p.id)::text AS track_count,
         (SELECT COALESCE(sum(t.duration), 0) FROM playlist_tracks t WHERE t.playlist_id = p.id)::text AS duration,
         (SELECT t.album_id FROM playlist_tracks t
           WHERE t.playlist_id = p.id AND t.album_id IS NOT NULL
           ORDER BY t.position LIMIT 1) AS cover_id,
         (SELECT count(*) FROM playlist_members m WHERE m.playlist_id = p.id)::text AS member_count,
         (SELECT m.role FROM playlist_members m
           WHERE m.playlist_id = p.id AND m.user_id = $1::uuid) AS viewer_role
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
    kind: row.kind,
    blendWith: row.blend_with,
    trackCount: Number.parseInt(row.track_count, 10),
    duration: Number.parseFloat(row.duration ?? '0'),
    coverUrl: row.cover_url,
    coverId: row.cover_id,
    memberCount: Number.parseInt(row.member_count ?? '0', 10),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    canEdit,
    isOwner: row.owner_id === viewerId,
    role: row.viewer_role,
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

/**
 * Can the viewer open it at all?
 *
 * Visibility decides who can *find* it; an invite is a grant on top of that,
 * which is how somebody gets into a private list without it becoming public.
 */
export async function canView(viewerId: string, row: PlaylistRow): Promise<boolean> {
  if (row.owner_id === viewerId) return true;
  // A blend belongs to both people in it, whatever its visibility says.
  if (row.kind === 'blend' && row.blend_with === viewerId) return true;
  if (row.viewer_role) return true;
  if (row.visibility === 'private') return false;
  if (row.visibility === 'everyone') return true;
  return (await friendStatusBetween(viewerId, row.owner_id)) === 'friends';
}

/**
 * Can the viewer change what is in it?
 *
 * The owner always can, and so can anyone invited as a collaborator. A viewer
 * cannot, however they found the playlist — being able to see something is not
 * permission to rewrite it. A blend is generated, so nobody edits it by hand.
 */
function canEditRow(viewerId: string, row: PlaylistRow): boolean {
  if (row.kind !== 'manual') return false;
  if (row.owner_id === viewerId) return true;
  return row.viewer_role === 'collaborator';
}

/** Loads a playlist, refusing anything the viewer may not open. */
async function load(viewerId: string, playlistId: string): Promise<PlaylistRow> {
  if (!/^[0-9a-f-]{36}$/i.test(playlistId)) {
    throw new AuthError('No such playlist.', 404, 'not_found');
  }
  const { rows } = await pool.query<PlaylistRow>(`${SELECT} WHERE p.id = $2`, [viewerId, playlistId]);
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
  return toPlaylist(row, viewerId, canEditRow(viewerId, row));
}

/**
 * Everything the viewer can open: their own, what they were invited to, and
 * what friends have shared.
 *
 * `ownerId` narrows it to one person's playlists, for a profile page — the
 * visibility rules are unchanged, so this only ever shows what that viewer
 * could have found anyway.
 */
export async function listPlaylists(viewerId: string, ownerId?: string): Promise<Playlist[]> {
  const { rows } = await pool.query<PlaylistRow>(
    `${SELECT}
      LEFT JOIN friendships f
        ON least(f.requester_id, f.addressee_id) = least(p.owner_id, $1::uuid)
       AND greatest(f.requester_id, f.addressee_id) = greatest(p.owner_id, $1::uuid)
       AND f.status = 'accepted'
      WHERE ($2::uuid IS NULL OR p.owner_id = $2)
        AND (p.owner_id = $1
         OR p.blend_with = $1
         OR EXISTS (SELECT 1 FROM playlist_members m
                     WHERE m.playlist_id = p.id AND m.user_id = $1)
         OR p.visibility = 'everyone'
         OR (p.visibility = 'friends' AND f.id IS NOT NULL))
      ORDER BY p.updated_at DESC`,
    [viewerId, ownerId ?? null],
  );

  return rows.map((row) => toPlaylist(row, viewerId, canEditRow(viewerId, row)));
}

export async function createPlaylist(
  ownerId: string,
  input: { name?: unknown; description?: unknown; visibility?: unknown },
) {
  const { rows: mine } = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM playlists WHERE owner_id = $1 AND kind = 'manual'",
    [ownerId],
  );
  if (Number.parseInt(mine[0]?.count ?? '0', 10) >= 200) {
    throw new AuthError('That is a lot of playlists — tidy some up first.', 429, 'too_many');
  }

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO playlists (owner_id, name, description, visibility)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [
      ownerId,
      name(input.name),
      typeof input.description === 'string' ? input.description.trim().slice(0, DESCRIPTION_LIMIT) || null : null,
      input.visibility === undefined ? 'friends' : visibility(input.visibility),
    ],
  );
  return getPlaylist(ownerId, rows[0]!.id);
}

export async function updatePlaylist(
  viewerId: string,
  playlistId: string,
  input: { name?: unknown; description?: unknown; visibility?: unknown },
) {
  const row = await load(viewerId, playlistId);
  // Renaming and sharing are the owner's alone: a collaborator adds music,
  // they don't decide who else sees it.
  if (row.owner_id !== viewerId) {
    throw new AuthError('Only the owner can change this playlist.', 403, 'not_owner');
  }

  await pool.query(
    `UPDATE playlists
        SET name = COALESCE($2, name),
            description = CASE WHEN $3::boolean THEN $4 ELSE description END,
            visibility = COALESCE($5, visibility),
            updated_at = now()
      WHERE id = $1`,
    [
      playlistId,
      input.name === undefined ? null : name(input.name),
      input.description !== undefined,
      typeof input.description === 'string' ? input.description.trim().slice(0, DESCRIPTION_LIMIT) || null : null,
      input.visibility === undefined ? null : visibility(input.visibility),
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
  if (!canEditRow(viewerId, row)) {
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

// ----------------------------------------------------------------- members

/**
 * Who has been invited, and as what.
 *
 * Readable by anyone who can open the playlist — knowing who else is in a
 * shared list is part of it being shared — but only the owner can change it.
 */
export async function listMembers(viewerId: string, playlistId: string): Promise<PlaylistMember[]> {
  await load(viewerId, playlistId);

  const { rows } = await pool.query<{
    user_id: string;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
    role: PlaylistRole;
    added_at: Date;
  }>(
    `SELECT m.user_id, m.role, m.added_at, u.username, u.display_name, u.avatar_url
       FROM playlist_members m
       JOIN users u ON u.id = m.user_id
      WHERE m.playlist_id = $1
      ORDER BY m.added_at`,
    [playlistId],
  );

  return rows.map((row) => ({
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    role: row.role,
    addedAt: row.added_at.toISOString(),
  }));
}

function role(value: unknown): PlaylistRole {
  if (value === 'viewer' || value === 'collaborator') return value;
  throw new AuthError('A member is either a viewer or a collaborator.', 400, 'invalid_role');
}

/** Only the owner decides who is in a playlist, and at what level. */
async function loadOwned(viewerId: string, playlistId: string): Promise<PlaylistRow> {
  const row = await load(viewerId, playlistId);
  if (row.owner_id !== viewerId) {
    throw new AuthError('Only the owner can change who is in this playlist.', 403, 'not_owner');
  }
  if (row.kind !== 'manual') {
    throw new AuthError('This playlist is generated — it has no members to invite.', 400, 'not_manual');
  }
  return row;
}

/**
 * Invites someone, or changes the role of someone already invited.
 *
 * Restricted to the owner's friends: this archive has no way to search
 * strangers, and an invite is the one thing here that reaches into somebody
 * else's library view.
 */
export async function setMember(
  viewerId: string,
  playlistId: string,
  userId: string,
  wanted: unknown,
): Promise<PlaylistMember[]> {
  await loadOwned(viewerId, playlistId);

  if (userId === viewerId) {
    throw new AuthError('You already own this playlist.', 400, 'invalid_member');
  }
  if (!/^[0-9a-f-]{36}$/i.test(userId)) {
    throw new AuthError('No such account.', 404, 'not_found');
  }
  if ((await friendStatusBetween(viewerId, userId)) !== 'friends') {
    throw new AuthError('You can only invite friends.', 403, 'not_friends');
  }

  await pool.query(
    `INSERT INTO playlist_members (playlist_id, user_id, role, added_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (playlist_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [playlistId, userId, role(wanted), viewerId],
  );

  await touch(playlistId);
  return listMembers(viewerId, playlistId);
}

export async function removeMember(
  viewerId: string,
  playlistId: string,
  userId: string,
): Promise<PlaylistMember[]> {
  // The owner can remove anyone; anyone can show themselves out.
  if (userId !== viewerId) await loadOwned(viewerId, playlistId);
  else await load(viewerId, playlistId);

  await pool.query('DELETE FROM playlist_members WHERE playlist_id = $1 AND user_id = $2', [
    playlistId,
    userId,
  ]);
  await touch(playlistId);
  return userId === viewerId ? [] : listMembers(viewerId, playlistId);
}

// ------------------------------------------------------------------- cover

/**
 * Sets or clears the uploaded cover.
 *
 * Clearing falls back to the first track's album art, which is what a playlist
 * shows until somebody chooses otherwise. The previous file is deleted only
 * after the new URL is safely on the row.
 */
export async function setCover(viewerId: string, playlistId: string, coverUrl: string | null) {
  const row = await loadOwned(viewerId, playlistId);
  await pool.query('UPDATE playlists SET cover_url = $2, updated_at = now() WHERE id = $1', [
    playlistId,
    coverUrl,
  ]);
  return { playlist: await getPlaylist(viewerId, playlistId), previousCoverUrl: row.cover_url };
}

// ------------------------------------------------------------------- blend

/**
 * Blend: one generated playlist per pair of friends.
 *
 * It is built from what both people actually played, so it needs no taste
 * model and no catalogue beyond this one — the archive is small enough that
 * two friends' listening genuinely overlaps.
 *
 * The list is rebuilt in place rather than recreated, so its URL survives a
 * refresh and a share sent last week still opens the current version.
 */

/** How many tracks a blend holds. Long enough for an evening. */
const BLEND_SIZE = 40;
/** Refreshed at most this often, unless someone asks for it. */
const BLEND_MAX_AGE_MS = 6 * 60 * 60 * 1000;

interface Candidate {
  trackId: string;
  title: string;
  artist: string;
  album: string | null;
  albumId: string | null;
  plays: number;
  /** Whether the other person has played it too. */
  shared: boolean;
}

/** Somebody's most-played tracks, newest listening weighted by simply being recent. */
async function topTracks(userId: string, limit: number) {
  const { rows } = await pool.query<{
    track_id: string;
    title: string;
    artist: string;
    album: string | null;
    album_id: string | null;
    plays: string;
  }>(
    `SELECT track_id, max(title) AS title, max(artist) AS artist,
            max(album) AS album, max(album_id) AS album_id, count(*)::text AS plays
       FROM play_history
      WHERE user_id = $1 AND played_at > now() - interval '180 days'
      GROUP BY track_id
      ORDER BY count(*) DESC, max(played_at) DESC
      LIMIT $2`,
    [userId, limit],
  );
  return rows.map((row) => ({
    trackId: row.track_id,
    title: row.title,
    artist: row.artist,
    album: row.album,
    albumId: row.album_id,
    plays: Number.parseInt(row.plays, 10),
  }));
}

/**
 * Picks the blend's tracks.
 *
 * Anything both people play goes in first — that is the part of a blend worth
 * having. The rest alternates between the two so neither taste dominates, and
 * only tracks the library can still resolve are kept.
 */
async function blendTracks(aId: string, bId: string): Promise<Candidate[]> {
  const [a, b] = await Promise.all([
    topTracks(aId, BLEND_SIZE * 2),
    topTracks(bId, BLEND_SIZE * 2),
  ]);

  const bIds = new Set(b.map((track) => track.trackId));
  const aIds = new Set(a.map((track) => track.trackId));

  const both = a
    .filter((track) => bIds.has(track.trackId))
    .map((track) => ({ ...track, shared: true }));

  const onlyA = a.filter((track) => !bIds.has(track.trackId)).map((t) => ({ ...t, shared: false }));
  const onlyB = b.filter((track) => !aIds.has(track.trackId)).map((t) => ({ ...t, shared: false }));

  const picked: Candidate[] = [...both];
  for (let i = 0; picked.length < BLEND_SIZE && (i < onlyA.length || i < onlyB.length); i += 1) {
    if (onlyA[i]) picked.push(onlyA[i]!);
    if (picked.length < BLEND_SIZE && onlyB[i]) picked.push(onlyB[i]!);
  }

  return picked.filter((track) => library.getTrack(track.trackId)).slice(0, BLEND_SIZE);
}

/** Replaces a blend's contents in one transaction, so it is never half-built. */
async function fillBlend(playlistId: string, tracks: Candidate[]) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM playlist_tracks WHERE playlist_id = $1', [playlistId]);
    for (const [index, track] of tracks.entries()) {
      const live = library.getTrack(track.trackId);
      await client.query(
        `INSERT INTO playlist_tracks
           (playlist_id, track_id, title, artist, album, album_id, duration, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          playlistId,
          track.trackId,
          live?.title ?? track.title,
          live?.artist ?? track.artist,
          live?.album ?? track.album,
          live?.albumId ?? track.albumId,
          live?.duration ?? null,
          index,
        ],
      );
    }
    await client.query('UPDATE playlists SET updated_at = now() WHERE id = $1', [playlistId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Opens the blend two friends share, building or refreshing it as needed.
 *
 * Either of them may ask for it and both get the same playlist — the unique
 * index on the ordered pair is what guarantees that, rather than a check that
 * two simultaneous requests could both pass.
 */
export async function openBlend(viewerId: string, otherId: string, force = false) {
  if (viewerId === otherId) {
    throw new AuthError('A blend needs two people.', 400, 'invalid_blend');
  }
  // Checked before it reaches a uuid column, so a malformed id is a 404 rather
  // than a database error.
  if (!/^[0-9a-f-]{36}$/i.test(otherId)) {
    throw new AuthError('No such account.', 404, 'not_found');
  }
  if ((await friendStatusBetween(viewerId, otherId)) !== 'friends') {
    throw new AuthError('You can only blend with a friend.', 403, 'not_friends');
  }

  const { rows: names } = await pool.query<{ id: string; username: string; display_name: string | null }>(
    'SELECT id, username, display_name FROM users WHERE id = ANY($1::uuid[])',
    [[viewerId, otherId]],
  );
  const nameOf = (id: string) => {
    const row = names.find((entry) => entry.id === id);
    return row ? row.display_name || row.username : 'Someone';
  };

  // The pair is ordered so both sides land on the same row.
  const [low, high] = viewerId < otherId ? [viewerId, otherId] : [otherId, viewerId];

  const { rows: found } = await pool.query<{ id: string; updated_at: Date }>(
    `SELECT id, updated_at FROM playlists
      WHERE kind = 'blend'
        AND least(owner_id, blend_with) = $1
        AND greatest(owner_id, blend_with) = $2`,
    [low, high],
  );

  let playlistId = found[0]?.id;
  let fresh = false;

  if (!playlistId) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO playlists (owner_id, blend_with, name, description, visibility, kind)
       VALUES ($1, $2, $3, $4, 'private', 'blend')
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        low,
        high,
        `${nameOf(low)} + ${nameOf(high)}`,
        'Built from what you have both been playing.',
      ],
    );
    playlistId = rows[0]?.id;

    // Lost the race with the other person's request: theirs is the one to use.
    if (!playlistId) {
      const { rows: raced } = await pool.query<{ id: string }>(
        `SELECT id FROM playlists
          WHERE kind = 'blend'
            AND least(owner_id, blend_with) = $1
            AND greatest(owner_id, blend_with) = $2`,
        [low, high],
      );
      playlistId = raced[0]!.id;
    } else {
      fresh = true;
    }
  }

  const age = found[0] ? Date.now() - found[0].updated_at.getTime() : Infinity;
  if (fresh || force || age > BLEND_MAX_AGE_MS) {
    await fillBlend(playlistId, await blendTracks(low, high));
  }

  return {
    playlist: await getPlaylist(viewerId, playlistId),
    entries: await listEntries(viewerId, playlistId),
  };
}
