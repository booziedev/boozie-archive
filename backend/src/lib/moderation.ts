import { pool } from '../db/pool.js';
import { AuthError } from './auth.js';

/**
 * Live moderation: seeing what is playing, stopping it, and timing somebody out.
 *
 * Two things worth being straight about, because they are the point rather
 * than an oversight:
 *
 *  - the live view **ignores each person's "who can see what I'm listening to"
 *    setting**. That setting governs other members; an admin of the server sees
 *    everything on it. It is their machine and their bandwidth, but it does
 *    override a choice the app offers people elsewhere.
 *  - a timeout is a lock on the account, not a ban. It expires by itself, so
 *    nobody has to remember to lift it.
 */

/** How stale a status can be and still count as "playing now". */
const LIVE_WINDOW = "2 minutes";
/** Longest timeout that can be handed out in one go. */
const MAX_TIMEOUT_MINUTES = 60 * 24 * 7;

export interface LiveListener {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: 'user' | 'admin';
  trackId: string;
  title: string;
  artist: string;
  album: string | null;
  albumId: string | null;
  coverId: string | null;
  duration: number | null;
  position: number;
  isPlaying: boolean;
  /** True for a radio station rather than a file. */
  isRadio: boolean;
  updatedAt: string;
  /** When an admin last asked them to stop, if ever. */
  forcePauseAt: string | null;
  timeoutUntil: string | null;
}

export interface TimedOutUser {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  timeoutUntil: string;
}

/**
 * Everyone playing something right now.
 *
 * Deliberately unfiltered by `status_visibility` — see the note above.
 */
export async function liveListeners(): Promise<LiveListener[]> {
  const { rows } = await pool.query<{
    user_id: string;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
    role: 'user' | 'admin';
    track_id: string;
    title: string;
    artist: string;
    album: string | null;
    album_id: string | null;
    cover_id: string | null;
    duration: number | null;
    position: number;
    is_playing: boolean;
    updated_at: Date;
    force_pause_at: Date | null;
    timeout_until: Date | null;
  }>(
    `SELECT s.*, u.username, u.display_name, u.avatar_url, u.role, u.timeout_until
       FROM listening_status s
       JOIN users u ON u.id = s.user_id
      WHERE s.updated_at > now() - interval '${LIVE_WINDOW}'
      ORDER BY s.updated_at DESC`,
  );

  return rows.map((row) => ({
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    role: row.role,
    trackId: row.track_id,
    title: row.title,
    artist: row.artist,
    album: row.album,
    albumId: row.album_id,
    coverId: row.cover_id,
    duration: row.duration,
    position: row.position,
    isPlaying: row.is_playing,
    isRadio: row.track_id.startsWith('rd_'),
    updatedAt: row.updated_at.toISOString(),
    forcePauseAt: row.force_pause_at?.toISOString() ?? null,
    timeoutUntil: row.timeout_until?.toISOString() ?? null,
  }));
}

/** Everyone currently timed out, so the tab can show them and offer to lift it. */
export async function timedOutUsers(): Promise<TimedOutUser[]> {
  const { rows } = await pool.query<{
    id: string;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
    timeout_until: Date;
  }>(
    `SELECT id, username, display_name, avatar_url, timeout_until
       FROM users
      WHERE timeout_until > now()
      ORDER BY timeout_until`,
  );

  return rows.map((row) => ({
    userId: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    timeoutUntil: row.timeout_until.toISOString(),
  }));
}

/**
 * Asks one account's player to stop.
 *
 * Writes a timestamp the client picks up on its next presence poll — a couple
 * of seconds — rather than opening a socket for something that happens rarely.
 * It is a request, not a lock: they can press play again straight afterwards.
 * Stopping somebody for longer than a moment is what a timeout is for.
 */
export async function forcePause(userId: string) {
  const { rowCount } = await pool.query(
    'UPDATE listening_status SET force_pause_at = now() WHERE user_id = $1',
    [userId],
  );
  if (!rowCount) throw new AuthError('That account is not playing anything.', 404, 'not_playing');
  return { ok: true as const };
}

/**
 * Times an account out for a number of minutes.
 *
 * The gate in index.ts refuses everything but signing out while it holds, and
 * the client turns that into a screen saying how long is left — being quietly
 * signed out with no explanation is what this avoids.
 */
export async function setTimeout(
  actorId: string,
  userId: string,
  minutes: number,
): Promise<{ timeoutUntil: string }> {
  if (userId === actorId) {
    throw new AuthError("You can't time yourself out.", 400, 'self_timeout');
  }
  const clamped = Math.min(Math.max(Math.round(minutes), 1), MAX_TIMEOUT_MINUTES);

  const { rows } = await pool.query<{ timeout_until: Date }>(
    `UPDATE users SET timeout_until = now() + ($2 || ' minutes')::interval
      WHERE id = $1
      RETURNING timeout_until`,
    [userId, String(clamped)],
  );
  if (!rows[0]) throw new AuthError('No such account.', 404, 'not_found');

  // Their player should stop too, rather than carrying on until they notice
  // that nothing else works.
  await pool.query('UPDATE listening_status SET force_pause_at = now() WHERE user_id = $1', [userId]);

  return { timeoutUntil: rows[0].timeout_until.toISOString() };
}

export async function clearTimeout(userId: string) {
  const { rowCount } = await pool.query('UPDATE users SET timeout_until = NULL WHERE id = $1', [
    userId,
  ]);
  if (!rowCount) throw new AuthError('No such account.', 404, 'not_found');
  return { ok: true as const };
}
