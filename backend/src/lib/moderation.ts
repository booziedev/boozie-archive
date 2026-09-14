import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { AuthError } from './auth.js';

/**
 * Live moderation: seeing what is playing, controlling it, and timing somebody
 * out.
 *
 * Three things worth being straight about, because they are the point rather
 * than an oversight:
 *
 *  - the live view **ignores each person's "who can see what I'm listening to"
 *    setting**. That setting governs other members; an admin of the server sees
 *    everything on it. It is their machine and their bandwidth, but it does
 *    override a choice the app offers people elsewhere.
 *  - a timeout is a lock on the account, not a ban. It expires by itself, so
 *    nobody has to remember to lift it.
 *  - a hold is the middle ground that used to be missing. Between "tap them on
 *    the shoulder once" and "throw them off the server" there was nothing, so
 *    the shoulder-tap got used for jobs it could not do.
 */

/** Longest timeout that can be handed out in one go. */
const MAX_TIMEOUT_MINUTES = 60 * 24 * 7;
/** Longest playback hold. Longer than this is really a timeout. */
const MAX_HOLD_MINUTES = 60 * 12;
/** Longest note that can be pushed to someone's screen. */
const MAX_NOTICE_LENGTH = 280;

/** The one-shot instructions a player knows how to obey. */
const COMMANDS = ['skip', 'stop'] as const;
export type PlaybackCommand = (typeof COMMANDS)[number];

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
  /**
   * 'archive' for this site's own player; otherwise the service the listener
   * scrobbles from. Nothing an admin does here reaches an external player, so
   * the tab has to be able to say which is which.
   */
  source: string;
  updatedAt: string;
  /** When the hold on this account runs out, if one is in force. */
  holdUntil: string | null;
  holdReason: string | null;
  timeoutUntil: string | null;
}

export interface LiveView {
  listeners: LiveListener[];
  /**
   * The server's clock at the moment these rows were read.
   *
   * The panel derives a live position from `position` plus the time elapsed
   * since `updatedAt`, and doing that against the *browser's* clock would
   * offset every bar by however far the two machines disagree. The party
   * payload has carried this for the same reason since listen-along shipped.
   */
  serverTime: string;
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
export async function liveListeners(): Promise<LiveView> {
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
    source: string;
    updated_at: Date;
    server_time: Date;
    playback_hold_until: Date | null;
    playback_hold_reason: string | null;
    timeout_until: Date | null;
  }>(
    /*
     * The window is the same one everyone else's friends list uses. It was two
     * minutes here against a 70-second TTL elsewhere, which left a closed
     * laptop sitting frozen in this tab for the best part of a minute after it
     * had already gone quiet for every other member — a ghost that made the
     * whole panel look wrong.
     */
    `SELECT s.*, u.username, u.display_name, u.avatar_url, u.role, u.timeout_until,
            u.playback_hold_until, u.playback_hold_reason, now() AS server_time
       FROM listening_status s
       JOIN users u ON u.id = s.user_id
      WHERE s.updated_at > now() - ($1 || ' seconds')::interval
      ORDER BY s.updated_at DESC`,
    [String(config.presenceTtlSeconds)],
  );

  const listeners = rows.map((row) => ({
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
    source: row.source ?? 'archive',
    updatedAt: row.updated_at.toISOString(),
    holdUntil: row.playback_hold_until?.toISOString() ?? null,
    holdReason: row.playback_hold_reason,
    timeoutUntil: row.timeout_until?.toISOString() ?? null,
  }));

  // now() is transaction time, so every row carries the same stamp; read it
  // from the first, and fall back to this process's clock for an empty list.
  return {
    listeners,
    serverTime: (rows[0]?.server_time ?? new Date()).toISOString(),
  };
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
 * Holds one account's playback for a while.
 *
 * This replaces the old force-pause, and the difference is the whole point.
 * That wrote a single timestamp which the client applied exactly once: the
 * listener pressed play again and was never troubled by it a second time. So
 * the only thing that actually *stopped* anyone was a timeout, which locks the
 * whole account out — far too big a hammer for "please stop for a minute".
 *
 * A hold is a state with an end. The player stays paused for its duration, the
 * play button says why, and it lifts itself. It is also enforced rather than
 * requested: `/api/stream` refuses this account while it holds, so a stale tab
 * or a client that ignores the instruction still goes quiet.
 *
 * It lives on the account, so it works on somebody between tracks — the old
 * one 404'd there, which is exactly when an admin tended to reach for it.
 */
export async function hold(
  actorId: string,
  userId: string,
  minutes: number,
  reason?: string,
): Promise<{ holdUntil: string; holdReason: string | null }> {
  if (userId === actorId) {
    throw new AuthError("You can't hold your own playback.", 400, 'self_hold');
  }
  const clamped = Math.min(Math.max(Math.round(minutes), 1), MAX_HOLD_MINUTES);
  const text = reason?.trim().slice(0, MAX_NOTICE_LENGTH) || null;

  const { rows } = await pool.query<{
    playback_hold_until: Date;
    playback_hold_reason: string | null;
  }>(
    `UPDATE users
        SET playback_hold_until = now() + ($2 || ' minutes')::interval,
            playback_hold_reason = $3
      WHERE id = $1
      RETURNING playback_hold_until, playback_hold_reason`,
    [userId, String(clamped), text],
  );
  if (!rows[0]) throw new AuthError('No such account.', 404, 'not_found');

  return {
    holdUntil: rows[0].playback_hold_until.toISOString(),
    holdReason: rows[0].playback_hold_reason,
  };
}

/** Lifts a hold early. Holds expire on their own, so this is only impatience. */
export async function releaseHold(userId: string) {
  const { rowCount } = await pool.query(
    'UPDATE users SET playback_hold_until = NULL, playback_hold_reason = NULL WHERE id = $1',
    [userId],
  );
  if (!rowCount) throw new AuthError('No such account.', 404, 'not_found');
  return { ok: true as const };
}

/**
 * Sends a one-shot instruction to somebody's player.
 *
 * `skip` moves them to the next track; `stop` ends playback and empties the
 * queue. Both ride the presence poll the client is already making, and are
 * deduped client-side by the stamp, so issuing one twice does nothing twice.
 */
export async function command(userId: string, instruction: string) {
  if (!COMMANDS.includes(instruction as PlaybackCommand)) {
    throw new AuthError(`Expected one of: ${COMMANDS.join(', ')}.`, 400, 'bad_command');
  }
  const { rowCount } = await pool.query(
    'UPDATE users SET playback_command = $2, playback_command_at = now() WHERE id = $1',
    [userId, instruction],
  );
  if (!rowCount) throw new AuthError('No such account.', 404, 'not_found');
  return { ok: true as const };
}

/** Puts a short note on one person's screen. The targeted announcement. */
export async function notice(userId: string, text: unknown) {
  const body = typeof text === 'string' ? text.trim().slice(0, MAX_NOTICE_LENGTH) : '';
  if (!body) throw new AuthError('A message is required.', 400, 'empty_notice');

  const { rowCount } = await pool.query(
    'UPDATE users SET admin_notice = $2, admin_notice_at = now() WHERE id = $1',
    [userId, body],
  );
  if (!rowCount) throw new AuthError('No such account.', 404, 'not_found');
  return { ok: true as const };
}

/**
 * Revokes every session an account holds, dropping its devices to the login
 * screen on their next request.
 *
 * The bluntest of these and the only one that does not depend on a client
 * choosing to cooperate — there is no instruction to ignore, the credential
 * simply stops existing.
 */
export async function signOutEverywhere(actorId: string, userId: string) {
  if (userId === actorId) {
    throw new AuthError('Use the ordinary sign-out for your own account.', 400, 'self_signout');
  }
  const { rows } = await pool.query<{ id: string }>('SELECT id FROM users WHERE id = $1', [userId]);
  if (!rows[0]) throw new AuthError('No such account.', 404, 'not_found');

  const { rowCount } = await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  return { ok: true as const, sessions: rowCount ?? 0 };
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
  // that nothing else works. The hold runs to the same moment, so the stream
  // is refused for exactly as long as the account is locked.
  await pool.query(
    `UPDATE users
        SET playback_hold_until = timeout_until,
            playback_hold_reason = 'Your account is timed out.'
      WHERE id = $1`,
    [userId],
  );

  return { timeoutUntil: rows[0].timeout_until.toISOString() };
}

export async function clearTimeout(userId: string) {
  // Lift the matching hold with it, or letting somebody back in would leave
  // their player refusing to play for the rest of the original sentence.
  const { rowCount } = await pool.query(
    `UPDATE users
        SET timeout_until = NULL,
            playback_hold_until = NULL,
            playback_hold_reason = NULL
      WHERE id = $1`,
    [userId],
  );
  if (!rowCount) throw new AuthError('No such account.', 404, 'not_found');
  return { ok: true as const };
}

/**
 * The hold in force on one account, if any.
 *
 * Read on the listener's own presence poll and by the stream routes, so it is
 * deliberately one small indexed lookup by primary key.
 */
export async function holdFor(
  userId: string,
): Promise<{ until: string; reason: string | null } | null> {
  const { rows } = await pool.query<{ playback_hold_until: Date; playback_hold_reason: string | null }>(
    `SELECT playback_hold_until, playback_hold_reason
       FROM users
      WHERE id = $1 AND playback_hold_until > now()`,
    [userId],
  );
  if (!rows[0]) return null;
  return { until: rows[0].playback_hold_until.toISOString(), reason: rows[0].playback_hold_reason };
}

/** The pending one-shot command and note for a listener's own poll. */
export async function pendingFor(userId: string): Promise<{
  command: PlaybackCommand | null;
  commandAt: string | null;
  notice: string | null;
  noticeAt: string | null;
}> {
  const { rows } = await pool.query<{
    playback_command: string | null;
    playback_command_at: Date | null;
    admin_notice: string | null;
    admin_notice_at: Date | null;
  }>(
    `SELECT playback_command, playback_command_at, admin_notice, admin_notice_at
       FROM users WHERE id = $1`,
    [userId],
  );
  const row = rows[0];
  const instruction = row?.playback_command;
  return {
    command: COMMANDS.includes(instruction as PlaybackCommand)
      ? (instruction as PlaybackCommand)
      : null,
    commandAt: row?.playback_command_at?.toISOString() ?? null,
    notice: row?.admin_notice ?? null,
    noticeAt: row?.admin_notice_at?.toISOString() ?? null,
  };
}
