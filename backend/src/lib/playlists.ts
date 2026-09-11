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
 * A playlist is either hand-made or generated. Generated ones are rebuilt from
 * the play log, which is why nobody edits their tracks.
 */
export type PlaylistKind = 'manual' | 'wrapped';

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
  kind: PlaylistKind;
  trackCount: number;
  duration: number;
  /** An uploaded cover, when there is one. */
  coverUrl: string | null;
  /** Which generator built it, for the ones that were generated. */
  generator: string | null;
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
  /** Whether the viewer has kept this playlist in their library. */
  saved: boolean;
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
  kind: PlaylistKind;
  cover_url: string | null;
  generator: string | null;
  created_at: Date;
  updated_at: Date;
  track_count: string;
  duration: string | null;
  cover_id: string | null;
  member_count: string;
  /** The asking viewer's role, resolved by the query rather than a second trip. */
  viewer_role: PlaylistRole | null;
  viewer_saved: boolean;
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
           WHERE m.playlist_id = p.id AND m.user_id = $1::uuid) AS viewer_role,
         EXISTS (SELECT 1 FROM playlist_saves s
                  WHERE s.playlist_id = p.id AND s.user_id = $1::uuid) AS viewer_saved
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
    trackCount: Number.parseInt(row.track_count, 10),
    duration: Number.parseFloat(row.duration ?? '0'),
    coverUrl: row.cover_url,
    generator: row.generator,
    coverId: row.cover_id,
    memberCount: Number.parseInt(row.member_count ?? '0', 10),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    canEdit,
    isOwner: row.owner_id === viewerId,
    role: row.viewer_role,
    saved: row.viewer_saved,
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
 * permission to rewrite it. A generated list is rebuilt from the play log, so
 * nobody edits it by hand.
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
 * The viewer's library: what they own, plus what they have kept.
 *
 * Nothing lands here on its own. A playlist being public, or friends-only and
 * made by a friend, means the viewer *can open* it — not that it belongs in
 * their library. They put it there by saving it, and can take it out again.
 *
 * `ownerId` switches this to "that person's playlists, as far as this viewer is
 * allowed to see them", which is what a profile page shows and how somebody
 * finds a playlist worth saving in the first place.
 */
export async function listPlaylists(viewerId: string, ownerId?: string): Promise<Playlist[]> {
  const { rows } = ownerId
    ? await pool.query<PlaylistRow>(
        `${SELECT}
          LEFT JOIN friendships f
            ON least(f.requester_id, f.addressee_id) = least(p.owner_id, $1::uuid)
           AND greatest(f.requester_id, f.addressee_id) = greatest(p.owner_id, $1::uuid)
           AND f.status = 'accepted'
          WHERE p.owner_id = $2
            AND (p.kind <> 'wrapped'
                 OR EXISTS (SELECT 1 FROM playlist_tracks t WHERE t.playlist_id = p.id))
            AND (p.owner_id = $1
             OR EXISTS (SELECT 1 FROM playlist_members m
                         WHERE m.playlist_id = p.id AND m.user_id = $1)
             OR p.visibility = 'everyone'
             OR (p.visibility = 'friends' AND f.id IS NOT NULL))
          ORDER BY p.updated_at DESC`,
        [viewerId, ownerId],
      )
    : await pool.query<PlaylistRow>(
        `${SELECT}
          LEFT JOIN friendships f
            ON least(f.requester_id, f.addressee_id) = least(p.owner_id, $1::uuid)
           AND greatest(f.requester_id, f.addressee_id) = greatest(p.owner_id, $1::uuid)
           AND f.status = 'accepted'
          WHERE (p.kind <> 'wrapped'
                 OR EXISTS (SELECT 1 FROM playlist_tracks t WHERE t.playlist_id = p.id))
            AND (p.owner_id = $1
             -- A saved playlist still has to be one the viewer may open: an
             -- owner who turns it private takes it out of everybody's library
             -- rather than leaving a card that 404s. The save itself is kept,
             -- so it reappears if they open it up again.
             OR (EXISTS (SELECT 1 FROM playlist_saves s
                          WHERE s.playlist_id = p.id AND s.user_id = $1)
                 AND (p.visibility = 'everyone'
                   OR EXISTS (SELECT 1 FROM playlist_members m
                               WHERE m.playlist_id = p.id AND m.user_id = $1)
                   OR (p.visibility = 'friends' AND f.id IS NOT NULL))))
          ORDER BY p.updated_at DESC`,
        [viewerId],
      );

  return rows.map((row) => toPlaylist(row, viewerId, canEditRow(viewerId, row)));
}

/**
 * Keeps a playlist in the viewer's library.
 *
 * Requires being able to open it, so saving cannot be used to pin something
 * that was never shared — and an owner saving their own changes nothing, since
 * their playlists are in their library already.
 */
export async function savePlaylist(viewerId: string, playlistId: string) {
  const row = await load(viewerId, playlistId);
  if (row.owner_id === viewerId) {
    throw new AuthError('This is already your playlist.', 400, 'own_playlist');
  }
  await pool.query(
    `INSERT INTO playlist_saves (user_id, playlist_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [viewerId, playlistId],
  );
  return getPlaylist(viewerId, playlistId);
}

/** Takes it back out. Silent when it was not saved — the end state is the same. */
export async function unsavePlaylist(viewerId: string, playlistId: string) {
  await pool.query('DELETE FROM playlist_saves WHERE user_id = $1 AND playlist_id = $2', [
    viewerId,
    playlistId,
  ]);
  return getPlaylist(viewerId, playlistId);
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
      row.kind !== 'manual'
        ? 'This playlist is built from your listening — it cannot be edited by hand.'
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

// ------------------------------------------------------- generated playlists

/** Fixed window fragments. Never built from anything a request supplies. */
const LAST_180_DAYS = "played_at > now() - interval '180 days'";
const LAST_30_DAYS = "played_at > now() - interval '30 days'";
const THIS_YEAR = "date_part('year', played_at) = date_part('year', now())";
const LAST_YEAR = "date_part('year', played_at) = date_part('year', now()) - 1";

interface Candidate {
  trackId: string;
  title: string;
  artist: string;
  album: string | null;
  albumId: string | null;
  plays: number;
}

/**
 * Somebody's most-played tracks over a window.
 *
 * `window` is a SQL fragment rather than a value because the shapes differ
 * (a rolling interval, a calendar year, an absence of listening); it is only
 * ever one of the constants below, never anything from a request.
 */
async function topTracks(userId: string, limit: number, window = LAST_180_DAYS) {
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
      WHERE user_id = $1 AND ${window}
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

/** Replaces a generated playlist's contents in one transaction, so it is never half-built. */
async function fillGenerated(playlistId: string, tracks: Candidate[]) {
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

// ----------------------------------------------------------------- wrapped

/**
 * "Your listening" — generated playlists built from one person's play log.
 *
 * The Wrapped/Replay idea, available all year rather than only in December,
 * and private until its owner decides otherwise. They are ordinary playlists
 * underneath, so sharing, covers and the download button all come for free;
 * what makes them different is that nobody edits the tracks by hand.
 */

export type Generator = 'top_year' | 'on_repeat' | 'time_capsule';

interface GeneratorSpec {
  /** The listening window, as one of the fixed fragments above. */
  window: string;
  size: number;
  /** How long a built list stays fresh. Infinity means "never rebuild". */
  maxAgeMs: number;
  title: (year: number) => string;
  description: string;
}

const GENERATORS: Record<Generator, GeneratorSpec> = {
  top_year: {
    window: THIS_YEAR,
    size: 50,
    maxAgeMs: 24 * 60 * 60 * 1000,
    title: (year) => `Your top tracks of ${year}`,
    description: 'The most played things in your library this year, rebuilt daily.',
  },
  on_repeat: {
    window: LAST_30_DAYS,
    size: 30,
    maxAgeMs: 6 * 60 * 60 * 1000,
    title: () => 'On repeat',
    description: 'What you have had on over the last month.',
  },
  time_capsule: {
    // Once a year is over it cannot change, so this is built once and kept.
    window: LAST_YEAR,
    size: 50,
    maxAgeMs: Number.POSITIVE_INFINITY,
    title: (year) => `Time capsule ${year - 1}`,
    description: 'What you were playing last year.',
  },
};

export function isGenerator(value: unknown): value is Generator {
  return value === 'top_year' || value === 'on_repeat' || value === 'time_capsule';
}

/**
 * A key that pins a generated list to the period it covers.
 *
 * "On repeat" is always the last thirty days, so it has none and is rebuilt in
 * place forever. The other two belong to a year: when the year turns, the key
 * changes and next year's is a new playlist rather than this one being
 * overwritten — which is the whole point of a time capsule.
 */
function generatorKey(generator: Generator, year: number): string | null {
  if (generator === 'on_repeat') return null;
  return String(generator === 'time_capsule' ? year - 1 : year);
}

/**
 * Opens one of the generated lists, building or refreshing it as needed.
 *
 * Created private: what somebody listens to is theirs to publish, and a
 * playlist that appeared on a profile without being asked for would be a
 * nasty surprise. The owner can change that afterwards like any other
 * playlist — `updatePlaylist` already allows it, while `canEditRow` keeps the
 * tracks themselves read-only.
 */
export async function openWrapped(userId: string, generator: Generator, force = false) {
  const spec = GENERATORS[generator];
  const year = new Date().getFullYear();
  const key = generatorKey(generator, year);

  const { rows: found } = await pool.query<{ id: string; updated_at: Date }>(
    `SELECT id, updated_at FROM playlists
      WHERE kind = 'wrapped' AND owner_id = $1 AND generator = $2
        AND COALESCE(generator_key, '') = COALESCE($3, '')`,
    [userId, generator, key],
  );

  let playlistId = found[0]?.id;
  let fresh = false;

  if (!playlistId) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO playlists (owner_id, name, description, visibility, kind, generator, generator_key)
       VALUES ($1, $2, $3, 'private', 'wrapped', $4, $5)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [userId, spec.title(year), spec.description, generator, key],
    );
    playlistId = rows[0]?.id;

    // Two tabs asking at once: the unique index picks a winner, and the loser
    // reads the row rather than failing.
    if (!playlistId) {
      const { rows: raced } = await pool.query<{ id: string }>(
        `SELECT id FROM playlists
          WHERE kind = 'wrapped' AND owner_id = $1 AND generator = $2
            AND COALESCE(generator_key, '') = COALESCE($3, '')`,
        [userId, generator, key],
      );
      playlistId = raced[0]!.id;
    } else {
      fresh = true;
    }
  }

  const age = found[0] ? Date.now() - found[0].updated_at.getTime() : Number.POSITIVE_INFINITY;
  if (fresh || force || age > spec.maxAgeMs) {
    const tracks = await topTracks(userId, spec.size, spec.window);
    await fillGenerated(
      playlistId,
      tracks.filter((track) => library.getTrack(track.trackId)),
    );
  }

  return {
    playlist: await getPlaylist(userId, playlistId),
    entries: await listEntries(userId, playlistId),
  };
}

/** All three, for the "Your listening" page. Cheap: each is one lookup. */
export async function openAllWrapped(userId: string) {
  const generators: Generator[] = ['on_repeat', 'top_year', 'time_capsule'];
  const results = await Promise.all(
    generators.map(async (generator) => ({
      generator,
      ...(await openWrapped(userId, generator)),
    })),
  );
  // A generator with nothing to show yet (no listening in that window) is left
  // out rather than presented as an empty playlist.
  return results.filter((result) => result.playlist.trackCount > 0);
}
