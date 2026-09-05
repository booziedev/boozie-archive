import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { AuthError } from './auth.js';
import { friendStatusBetween, openThread, sendMessage } from './social.js';

/**
 * "Listening now" statuses and listen-along sessions.
 *
 * Both are built on one heartbeat. While something is loaded, the client PUTs
 * its now-playing state; that single write updates the sender's status and, if
 * they happen to be hosting a party, the party everyone else is following. No
 * websocket: iOS drops them the moment the app is backgrounded, and polling a
 * primary-key row costs the Pi almost nothing.
 *
 * Liveness is a read-time question — "was this written recently?" — so nothing
 * needs to run on a schedule to notice that a browser went away.
 */

export type StatusVisibility = 'everyone' | 'friends' | 'nobody';

/** What the player reports about the track it has loaded. */
export interface NowPlayingInput {
  trackId: string;
  title: string;
  artist: string;
  album?: string | null;
  albumId?: string | null;
  coverId?: string | null;
  duration?: number | null;
  position?: number | null;
  isPlaying?: boolean;
}

export interface NowPlaying {
  trackId: string;
  title: string;
  artist: string;
  album: string | null;
  albumId: string | null;
  coverId: string | null;
  duration: number | null;
  position: number;
  isPlaying: boolean;
  updatedAt: string;
}

export interface PartyState {
  id: string;
  hostId: string;
  hostUsername: string;
  hostDisplayName: string | null;
  /** Null before the host has started anything. */
  now: NowPlaying | null;
  /** Server clock when the position was sampled, for drift correction. */
  positionAt: string;
  /** Server clock at the moment of the reply, so a guest can extrapolate. */
  serverTime: string;
  listeners: { id: string; username: string; displayName: string | null; avatarUrl: string | null }[];
  live: boolean;
  isHost: boolean;
}

const TEXT_LIMIT = 300;

/** Trims and caps a denormalised label, or returns null for an empty one. */
function label(value: unknown, limit = TEXT_LIMIT): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, limit) : null;
}

function seconds(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  // A day is far past any real track and keeps a bad value from poisoning the
  // guest-side clock arithmetic.
  return Math.min(parsed, 86_400);
}

/**
 * Validates a now-playing payload.
 *
 * Track ids are matched against the library's own id shape rather than looked
 * up: the index lives in another module and a status is only ever rendered as
 * text plus a cover request, which fails closed on its own if the id is stale.
 */
function cleanNowPlaying(raw: unknown): NowPlayingInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;

  const trackId = label(value.trackId, 64);
  if (!trackId || !/^[a-z]{2}_[A-Za-z0-9_-]{1,60}$/.test(trackId)) return null;

  const title = label(value.title, 200);
  const artist = label(value.artist, 200);
  if (!title || !artist) return null;

  const albumId = label(value.albumId, 64);
  const coverId = label(value.coverId, 64);
  const idShape = /^[a-z]{2}_[A-Za-z0-9_-]{1,60}$/;

  return {
    trackId,
    title,
    artist,
    album: label(value.album, 200),
    albumId: albumId && idShape.test(albumId) ? albumId : null,
    coverId: coverId && idShape.test(coverId) ? coverId : null,
    duration: seconds(value.duration),
    position: seconds(value.position) ?? 0,
    isPlaying: value.isPlaying === true,
  };
}

// ------------------------------------------------------------------ presence

interface StatusRow {
  user_id: string;
  track_id: string;
  title: string;
  artist: string;
  album: string | null;
  album_id: string | null;
  cover_id: string | null;
  duration: number | null;
  position: number | null;
  is_playing: boolean;
  updated_at: Date;
}

function toNowPlaying(row: StatusRow): NowPlaying {
  return {
    trackId: row.track_id,
    title: row.title,
    artist: row.artist,
    album: row.album,
    albumId: row.album_id,
    coverId: row.cover_id,
    duration: row.duration,
    position: row.position ?? 0,
    isPlaying: row.is_playing,
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function getStatusVisibility(userId: string): Promise<StatusVisibility> {
  const { rows } = await pool.query<{ status_visibility: StatusVisibility }>(
    'SELECT status_visibility FROM users WHERE id = $1',
    [userId],
  );
  return rows[0]?.status_visibility ?? 'friends';
}

export async function getPrivacy(userId: string) {
  const { rows } = await pool.query<{
    status_visibility: StatusVisibility;
    allow_party_invites: boolean;
  }>('SELECT status_visibility, allow_party_invites FROM users WHERE id = $1', [userId]);
  const row = rows[0];
  return {
    statusVisibility: row?.status_visibility ?? ('friends' as StatusVisibility),
    allowPartyInvites: row?.allow_party_invites ?? true,
  };
}

export async function updatePrivacy(
  userId: string,
  input: { statusVisibility?: unknown; allowPartyInvites?: unknown },
) {
  const patch: { statusVisibility?: StatusVisibility; allowPartyInvites?: boolean } = {};

  if (input.statusVisibility !== undefined) {
    const value = String(input.statusVisibility);
    if (value !== 'everyone' && value !== 'friends' && value !== 'nobody') {
      throw new AuthError('Unknown status visibility.', 400, 'invalid_privacy');
    }
    patch.statusVisibility = value;
  }
  if (input.allowPartyInvites !== undefined) {
    patch.allowPartyInvites = input.allowPartyInvites === true;
  }

  await pool.query(
    `UPDATE users
        SET status_visibility = COALESCE($2, status_visibility),
            allow_party_invites = COALESCE($3, allow_party_invites)
      WHERE id = $1`,
    [userId, patch.statusVisibility ?? null, patch.allowPartyInvites ?? null],
  );

  // Hiding your status retracts the one already out there, rather than leaving
  // the last track visible until it expires.
  if (patch.statusVisibility === 'nobody') await clearNowPlaying(userId);

  return getPrivacy(userId);
}

/**
 * Records what someone is playing, and mirrors it into the party they host.
 *
 * Returns the party (when there is one) so the host's client can render the
 * listener list from the same round trip it was already making.
 */
export async function heartbeat(
  userId: string,
  raw: unknown,
): Promise<{ now: NowPlaying | null; party: PartyState | null }> {
  const input = cleanNowPlaying(raw);

  if (!input) {
    await clearNowPlaying(userId);
  } else if ((await getStatusVisibility(userId)) === 'nobody') {
    // Nothing to show anyone, so nothing is stored — but a party the person is
    // hosting still needs the position, or their guests would stall.
    await clearNowPlaying(userId);
  } else {
    await pool.query(
      `INSERT INTO listening_status
         (user_id, track_id, title, artist, album, album_id, cover_id,
          duration, position, is_playing, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
       ON CONFLICT (user_id) DO UPDATE SET
         track_id = EXCLUDED.track_id, title = EXCLUDED.title, artist = EXCLUDED.artist,
         album = EXCLUDED.album, album_id = EXCLUDED.album_id, cover_id = EXCLUDED.cover_id,
         duration = EXCLUDED.duration, position = EXCLUDED.position,
         is_playing = EXCLUDED.is_playing, updated_at = now()`,
      [
        userId,
        input.trackId,
        input.title,
        input.artist,
        input.album,
        input.albumId,
        input.coverId,
        input.duration,
        input.position ?? 0,
        input.isPlaying ?? false,
      ],
    );
  }

  const party = await pushHostState(userId, input);
  return { now: input ? await myNowPlaying(userId) : null, party };
}

export async function clearNowPlaying(userId: string) {
  await pool.query('DELETE FROM listening_status WHERE user_id = $1', [userId]);
}

async function myNowPlaying(userId: string): Promise<NowPlaying | null> {
  const { rows } = await pool.query<StatusRow>(
    'SELECT * FROM listening_status WHERE user_id = $1',
    [userId],
  );
  return rows[0] ? toNowPlaying(rows[0]) : null;
}

/**
 * One person's status, as the viewer is allowed to see it.
 *
 * The visibility check runs in SQL alongside the friendship lookup so there is
 * no window where a caller gets a row the owner has just hidden.
 */
export async function statusFor(viewerId: string, userId: string): Promise<NowPlaying | null> {
  const { rows } = await pool.query<StatusRow>(
    `SELECT s.*
       FROM listening_status s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN friendships f
         ON least(f.requester_id, f.addressee_id) = least(u.id, $1::uuid)
        AND greatest(f.requester_id, f.addressee_id) = greatest(u.id, $1::uuid)
        AND f.status = 'accepted'
      WHERE s.user_id = $2
        AND s.updated_at > now() - ($3 || ' seconds')::interval
        AND (
          u.id = $1
          OR u.status_visibility = 'everyone'
          OR (u.status_visibility = 'friends' AND f.id IS NOT NULL)
        )`,
    [viewerId, userId, String(config.presenceTtlSeconds)],
  );
  return rows[0] ? toNowPlaying(rows[0]) : null;
}

/** Every friend's status the viewer may see, keyed by user id. */
export async function friendStatuses(viewerId: string): Promise<Record<string, NowPlaying>> {
  const { rows } = await pool.query<StatusRow>(
    `SELECT s.*
       FROM listening_status s
       JOIN users u ON u.id = s.user_id AND u.disabled = false
       JOIN friendships f
         ON least(f.requester_id, f.addressee_id) = least(u.id, $1::uuid)
        AND greatest(f.requester_id, f.addressee_id) = greatest(u.id, $1::uuid)
        AND f.status = 'accepted'
      WHERE s.updated_at > now() - ($2 || ' seconds')::interval
        AND u.status_visibility IN ('everyone', 'friends')`,
    [viewerId, String(config.presenceTtlSeconds)],
  );

  const statuses: Record<string, NowPlaying> = {};
  for (const row of rows) statuses[row.user_id] = toNowPlaying(row);
  return statuses;
}

// ------------------------------------------------------------------- parties

interface PartyRow {
  id: string;
  host_id: string;
  track_id: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  album_id: string | null;
  cover_id: string | null;
  duration: number | null;
  position: number;
  is_playing: boolean;
  position_at: Date;
  updated_at: Date;
  ended_at: Date | null;
  host_username: string;
  host_display_name: string | null;
}

const PARTY_SELECT = /* sql */ `
  SELECT p.*, u.username AS host_username, u.display_name AS host_display_name
    FROM listen_parties p
    JOIN users u ON u.id = p.host_id
`;

async function toPartyState(row: PartyRow, viewerId: string): Promise<PartyState> {
  const { rows: members } = await pool.query<{
    id: string;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
  }>(
    `SELECT u.id, u.username, u.display_name, u.avatar_url
       FROM listen_party_members m
       JOIN users u ON u.id = m.user_id
      WHERE m.party_id = $1 AND u.disabled = false
      ORDER BY m.joined_at`,
    [row.id],
  );

  const live = row.ended_at === null && !isStale(row.updated_at);

  return {
    id: row.id,
    hostId: row.host_id,
    hostUsername: row.host_username,
    hostDisplayName: row.host_display_name,
    now:
      row.track_id && row.title && row.artist
        ? {
            trackId: row.track_id,
            title: row.title,
            artist: row.artist,
            album: row.album,
            albumId: row.album_id,
            coverId: row.cover_id,
            duration: row.duration,
            position: row.position,
            isPlaying: row.is_playing,
            updatedAt: row.updated_at.toISOString(),
          }
        : null,
    positionAt: row.position_at.toISOString(),
    serverTime: new Date().toISOString(),
    listeners: members.map((member) => ({
      id: member.id,
      username: member.username,
      displayName: member.display_name,
      avatarUrl: member.avatar_url,
    })),
    live,
    isHost: row.host_id === viewerId,
  };
}

function isStale(updatedAt: Date): boolean {
  return Date.now() - updatedAt.getTime() > config.partyTtlSeconds * 1000;
}

/** Starts hosting, or returns the session this person already hosts. */
export async function startParty(userId: string): Promise<PartyState> {
  // A host whose browser died leaves a row behind; reuse it rather than
  // colliding with the one-live-party index.
  const { rows: existing } = await pool.query<PartyRow>(
    `${PARTY_SELECT} WHERE p.host_id = $1 AND p.ended_at IS NULL`,
    [userId],
  );

  if (existing[0]) {
    await pool.query('UPDATE listen_parties SET updated_at = now() WHERE id = $1', [existing[0].id]);
    const { rows } = await pool.query<PartyRow>(`${PARTY_SELECT} WHERE p.id = $1`, [existing[0].id]);
    return toPartyState(rows[0]!, userId);
  }

  const { rows: created } = await pool.query<{ id: string }>(
    'INSERT INTO listen_parties (host_id) VALUES ($1) RETURNING id',
    [userId],
  );
  const partyId = created[0]!.id;

  // The host counts as a listener, so the member list reads as the room.
  await pool.query(
    `INSERT INTO listen_party_members (party_id, user_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [partyId, userId],
  );

  const { rows } = await pool.query<PartyRow>(`${PARTY_SELECT} WHERE p.id = $1`, [partyId]);
  return toPartyState(rows[0]!, userId);
}

/** Mirrors the host's player into their party. No-op for anyone not hosting. */
async function pushHostState(
  userId: string,
  input: NowPlayingInput | null,
): Promise<PartyState | null> {
  const { rows } = await pool.query<PartyRow>(
    `${PARTY_SELECT} WHERE p.host_id = $1 AND p.ended_at IS NULL`,
    [userId],
  );
  const party = rows[0];
  if (!party) return null;

  await pool.query(
    `UPDATE listen_parties
        SET track_id = $2, title = $3, artist = $4, album = $5, album_id = $6, cover_id = $7,
            duration = $8, position = $9, is_playing = $10,
            position_at = now(), updated_at = now()
      WHERE id = $1`,
    [
      party.id,
      input?.trackId ?? null,
      input?.title ?? null,
      input?.artist ?? null,
      input?.album ?? null,
      input?.albumId ?? null,
      input?.coverId ?? null,
      input?.duration ?? null,
      input?.position ?? 0,
      input?.isPlaying ?? false,
    ],
  );

  const { rows: fresh } = await pool.query<PartyRow>(`${PARTY_SELECT} WHERE p.id = $1`, [party.id]);
  return toPartyState(fresh[0]!, userId);
}

/** Reads a party, proving the caller is allowed to see it. */
export async function getParty(viewerId: string, partyId: string): Promise<PartyState> {
  if (!/^[0-9a-f-]{36}$/i.test(partyId)) {
    throw new AuthError('No such listening session.', 404, 'not_found');
  }

  const { rows } = await pool.query<PartyRow>(`${PARTY_SELECT} WHERE p.id = $1`, [partyId]);
  const party = rows[0];
  if (!party) throw new AuthError('No such listening session.', 404, 'not_found');

  // Only the host and their friends can read a session — an invite is how you
  // find one, friendship is what authorises it. A stranger holding a leaked id
  // gets the same answer as one holding a made-up id.
  if (party.host_id !== viewerId) {
    const status = await friendStatusBetween(viewerId, party.host_id);
    if (status !== 'friends') {
      throw new AuthError('No such listening session.', 404, 'not_found');
    }
  }

  // Reading is also a check-in, so a guest's presence in the room stays fresh.
  await pool.query(
    'UPDATE listen_party_members SET last_seen_at = now() WHERE party_id = $1 AND user_id = $2',
    [partyId, viewerId],
  );

  return toPartyState(party, viewerId);
}

/** The live session this person is hosting or following, if any. */
export async function currentParty(userId: string): Promise<PartyState | null> {
  const { rows } = await pool.query<PartyRow>(
    `${PARTY_SELECT}
       JOIN listen_party_members m ON m.party_id = p.id AND m.user_id = $1
      WHERE p.ended_at IS NULL
      ORDER BY p.updated_at DESC
      LIMIT 1`,
    [userId],
  );
  const party = rows[0];
  if (!party) return null;

  // A host who vanished shouldn't strand their guests in a dead room.
  if (isStale(party.updated_at)) {
    if (party.host_id === userId) return toPartyState(party, userId);
    await leaveParty(userId, party.id).catch(() => undefined);
    return null;
  }
  return toPartyState(party, userId);
}

export async function joinParty(userId: string, partyId: string): Promise<PartyState> {
  const party = await getParty(userId, partyId);
  if (!party.live) {
    throw new AuthError('That listening session has ended.', 410, 'party_ended');
  }

  // Following two hosts at once would have them fight over the same audio
  // element, so joining leaves whatever room you were in.
  await pool.query(
    `DELETE FROM listen_party_members
      WHERE user_id = $1 AND party_id <> $2`,
    [userId, partyId],
  );
  await pool.query(
    `INSERT INTO listen_party_members (party_id, user_id) VALUES ($1, $2)
     ON CONFLICT (party_id, user_id) DO UPDATE SET last_seen_at = now()`,
    [partyId, userId],
  );

  return getParty(userId, partyId);
}

/** Leaves a session; the host leaving ends it for everyone. */
export async function leaveParty(userId: string, partyId: string) {
  const { rows } = await pool.query<{ host_id: string }>(
    'SELECT host_id FROM listen_parties WHERE id = $1',
    [partyId],
  );
  const party = rows[0];
  if (!party) return { ok: true as const };

  if (party.host_id === userId) {
    await pool.query(
      'UPDATE listen_parties SET ended_at = now(), is_playing = false WHERE id = $1 AND ended_at IS NULL',
      [partyId],
    );
    await pool.query('DELETE FROM listen_party_members WHERE party_id = $1', [partyId]);
  } else {
    await pool.query(
      'DELETE FROM listen_party_members WHERE party_id = $1 AND user_id = $2',
      [partyId, userId],
    );
  }
  return { ok: true as const };
}

/**
 * Sends a listen-along invite as a direct message.
 *
 * It goes through the normal message path, so the friends-only rule, the rate
 * limit and the thread's read state all apply exactly as they do to anything
 * else someone sends.
 */
export async function inviteToParty(userId: string, partyId: string, targetId: string) {
  const party = await getParty(userId, partyId);
  if (!party.isHost) {
    throw new AuthError('Only the host can invite people.', 403, 'not_host');
  }
  if (!party.live) {
    throw new AuthError('That listening session has ended.', 410, 'party_ended');
  }

  const { rows } = await pool.query<{ allow_party_invites: boolean; username: string }>(
    'SELECT allow_party_invites, username FROM users WHERE id = $1 AND disabled = false',
    [targetId],
  );
  const target = rows[0];
  if (!target) throw new AuthError('That account does not exist.', 404, 'not_found');
  if (!target.allow_party_invites) {
    throw new AuthError(
      `${target.username} has turned off listen-along invites.`,
      403,
      'invites_disabled',
    );
  }

  const threadId = await openThread(userId, targetId);
  const message = await sendMessage(userId, threadId, {
    attachment: {
      kind: 'party',
      id: partyId,
      name: party.hostDisplayName || party.hostUsername,
    },
  });

  return { threadId, message };
}
