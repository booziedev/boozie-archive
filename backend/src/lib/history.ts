import { pool } from '../db/pool.js';

/**
 * The listening log.
 *
 * One row per play, written by the player when a track has been listened to
 * for long enough to count. Everything built on top — recently played, play
 * counts, the yearly recap, and the Blend playlists — is a query against this
 * one table rather than state kept anywhere else.
 *
 * The client decides *when* a play counts; this module decides what a valid
 * row looks like and refuses anything it cannot vouch for.
 */

export interface PlayInput {
  trackId: string;
  title: string;
  artist: string;
  album?: string | null;
  albumId?: string | null;
  msPlayed?: number | null;
  completed?: boolean;
}

export interface PlayRecord {
  id: string;
  trackId: string;
  title: string;
  artist: string;
  album: string | null;
  albumId: string | null;
  msPlayed: number;
  completed: boolean;
  playedAt: string;
}

/** Same id shape the library index generates. */
const ID_SHAPE = /^[a-z]{2}_[A-Za-z0-9_-]{1,60}$/;

function label(value: unknown, limit: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, limit) : null;
}

/**
 * Validates a reported play.
 *
 * Returns null for anything malformed rather than throwing: a bad row in the
 * listening log is not worth interrupting playback over, and the client has
 * nothing useful to do with the error.
 */
export function cleanPlay(raw: unknown): PlayInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;

  const trackId = label(value.trackId, 64);
  if (!trackId || !ID_SHAPE.test(trackId)) return null;
  /*
   * Radio never enters the log.
   *
   * A station has no duration and plays for hours, so it would dominate every
   * count it touched and poison the things built on them — top played, the
   * recap, Blend and the wrapped lists. The player already skips reporting it;
   * this is the half that a hand-written request cannot get around.
   */
  if (trackId.startsWith('rd_')) return null;

  const title = label(value.title, 200);
  const artist = label(value.artist, 200);
  if (!title || !artist) return null;

  const albumId = label(value.albumId, 64);
  const msPlayed = Number(value.msPlayed);

  return {
    trackId,
    title,
    artist,
    album: label(value.album, 200),
    albumId: albumId && ID_SHAPE.test(albumId) ? albumId : null,
    // A day of playback is far past any real track; the cap keeps one bad
    // number from dominating every "time listened" total forever.
    msPlayed: Number.isFinite(msPlayed) && msPlayed > 0 ? Math.min(Math.round(msPlayed), 86_400_000) : 0,
    completed: value.completed === true,
  };
}

export async function recordPlay(userId: string, input: PlayInput): Promise<PlayRecord> {
  const { rows } = await pool.query<{ id: string; played_at: Date }>(
    `INSERT INTO play_history
       (user_id, track_id, title, artist, album, album_id, ms_played, completed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, played_at`,
    [
      userId,
      input.trackId,
      input.title,
      input.artist,
      input.album ?? null,
      input.albumId ?? null,
      input.msPlayed ?? 0,
      input.completed ?? false,
    ],
  );

  return {
    id: String(rows[0]!.id),
    trackId: input.trackId,
    title: input.title,
    artist: input.artist,
    album: input.album ?? null,
    albumId: input.albumId ?? null,
    msPlayed: input.msPlayed ?? 0,
    completed: input.completed ?? false,
    playedAt: rows[0]!.played_at.toISOString(),
  };
}

interface HistoryRow {
  id: string;
  track_id: string;
  title: string;
  artist: string;
  album: string | null;
  album_id: string | null;
  ms_played: number;
  completed: boolean;
  played_at: Date;
}

function toRecord(row: HistoryRow): PlayRecord {
  return {
    id: String(row.id),
    trackId: row.track_id,
    title: row.title,
    artist: row.artist,
    album: row.album,
    albumId: row.album_id,
    msPlayed: row.ms_played,
    completed: row.completed,
    playedAt: row.played_at.toISOString(),
  };
}

/**
 * The most recent plays, one row per track.
 *
 * Collapsed by track, because a "recently played" row that shows the same
 * album five times because it was on repeat is not telling anyone anything.
 */
export async function recentPlays(userId: string, limit = 20): Promise<PlayRecord[]> {
  const { rows } = await pool.query<HistoryRow>(
    `SELECT DISTINCT ON (track_id) *
       FROM play_history
      WHERE user_id = $1
      ORDER BY track_id, played_at DESC`,
    [userId],
  );

  return rows
    .map(toRecord)
    .sort((a, b) => b.playedAt.localeCompare(a.playedAt))
    .slice(0, Math.min(Math.max(limit, 1), 100));
}

/** How many times this account has played each of the given tracks. */
export async function playCounts(
  userId: string,
  trackIds: string[],
): Promise<Record<string, number>> {
  if (trackIds.length === 0) return {};

  const { rows } = await pool.query<{ track_id: string; count: string }>(
    `SELECT track_id, count(*)::text AS count
       FROM play_history
      WHERE user_id = $1 AND track_id = ANY($2::text[])
      GROUP BY track_id`,
    [userId, trackIds.slice(0, 500)],
  );

  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.track_id] = Number.parseInt(row.count, 10);
  return counts;
}

export type Range = 'week' | 'month' | 'year' | 'all';

/** Postgres interval for a range, or null for "everything". */
function intervalFor(range: Range): string | null {
  switch (range) {
    case 'week':
      return '7 days';
    case 'month':
      return '30 days';
    case 'year':
      return '365 days';
    default:
      return null;
  }
}

export interface TopEntry {
  key: string;
  name: string;
  subtitle: string | null;
  /** Album id where there is one, so the row can link and show a cover. */
  albumId: string | null;
  plays: number;
  msPlayed: number;
}

/**
 * Most-played tracks, artists or albums over a window.
 *
 * Grouped by the denormalised labels rather than by id: a re-tag that changes
 * a track's id should not split its history into two half-height entries.
 */
export async function topPlayed(
  userId: string,
  kind: 'track' | 'artist' | 'album',
  range: Range = 'month',
  limit = 20,
): Promise<TopEntry[]> {
  const interval = intervalFor(range);
  const window = interval ? `AND played_at > now() - interval '${interval}'` : '';

  const grouping =
    kind === 'artist'
      ? { key: 'artist', name: 'artist', subtitle: 'NULL', albumId: 'NULL' }
      : kind === 'album'
        ? { key: 'album', name: 'album', subtitle: 'artist', albumId: 'album_id' }
        : { key: 'title', name: 'title', subtitle: 'artist', albumId: 'album_id' };

  const { rows } = await pool.query<{
    key: string;
    name: string;
    subtitle: string | null;
    album_id: string | null;
    plays: string;
    ms_played: string;
  }>(
    `SELECT ${grouping.key} AS key,
            ${grouping.name} AS name,
            ${kind === 'artist' ? 'NULL::text' : `max(${grouping.subtitle})`} AS subtitle,
            ${kind === 'artist' ? 'NULL::text' : `max(${grouping.albumId})`} AS album_id,
            count(*)::text AS plays,
            sum(ms_played)::text AS ms_played
       FROM play_history
      WHERE user_id = $1 ${window}
        AND ${grouping.key} IS NOT NULL
      GROUP BY ${grouping.key}${kind === 'track' ? ', artist' : ''}
      ORDER BY count(*) DESC, sum(ms_played) DESC
      LIMIT $2`,
    [userId, Math.min(Math.max(limit, 1), 100)],
  );

  return rows.map((row) => ({
    key: row.key,
    name: row.name,
    subtitle: row.subtitle,
    albumId: row.album_id,
    plays: Number.parseInt(row.plays, 10),
    msPlayed: Number.parseInt(row.ms_played ?? '0', 10),
  }));
}

export interface Recap {
  range: Range;
  from: string | null;
  plays: number;
  tracks: number;
  artists: number;
  albums: number;
  msPlayed: number;
  /** The hour of day, 0-23, with the most plays. Null with no history. */
  peakHour: number | null;
  firstPlayAt: string | null;
  topTracks: TopEntry[];
  topArtists: TopEntry[];
  topAlbums: TopEntry[];
}

/**
 * The numbers behind a Wrapped-style summary.
 *
 * Available for any window, all year round — the annual-event framing is a
 * marketing decision, not a technical one, and "what did I play this month"
 * is the question people actually ask.
 */
export async function recap(userId: string, range: Range = 'year'): Promise<Recap> {
  const interval = intervalFor(range);
  const window = interval ? `AND played_at > now() - interval '${interval}'` : '';

  const { rows } = await pool.query<{
    plays: string;
    tracks: string;
    artists: string;
    albums: string;
    ms_played: string;
    peak_hour: string | null;
    first_play: Date | null;
  }>(
    `SELECT count(*)::text AS plays,
            count(DISTINCT track_id)::text AS tracks,
            count(DISTINCT artist)::text AS artists,
            count(DISTINCT album) FILTER (WHERE album IS NOT NULL)::text AS albums,
            COALESCE(sum(ms_played), 0)::text AS ms_played,
            (SELECT extract(hour FROM played_at)::text
               FROM play_history
              WHERE user_id = $1 ${window}
              GROUP BY extract(hour FROM played_at)
              ORDER BY count(*) DESC
              LIMIT 1) AS peak_hour,
            min(played_at) AS first_play
       FROM play_history
      WHERE user_id = $1 ${window}`,
    [userId],
  );
  const summary = rows[0];

  const [topTracks, topArtists, topAlbums] = await Promise.all([
    topPlayed(userId, 'track', range, 10),
    topPlayed(userId, 'artist', range, 10),
    topPlayed(userId, 'album', range, 10),
  ]);

  return {
    range,
    from: interval ? new Date(Date.now() - windowMs(interval)).toISOString() : null,
    plays: Number.parseInt(summary?.plays ?? '0', 10),
    tracks: Number.parseInt(summary?.tracks ?? '0', 10),
    artists: Number.parseInt(summary?.artists ?? '0', 10),
    albums: Number.parseInt(summary?.albums ?? '0', 10),
    msPlayed: Number.parseInt(summary?.ms_played ?? '0', 10),
    peakHour: summary?.peak_hour === null || summary?.peak_hour === undefined
      ? null
      : Number.parseInt(summary.peak_hour, 10),
    firstPlayAt: summary?.first_play ? summary.first_play.toISOString() : null,
    topTracks,
    topArtists,
    topAlbums,
  };
}

/** Milliseconds for the intervals above, for reporting the window start. */
function windowMs(interval: string): number {
  const days = Number.parseInt(interval, 10);
  return days * 86_400_000;
}

/** Wipes this account's listening log. */
export async function clearHistory(userId: string) {
  const { rowCount } = await pool.query('DELETE FROM play_history WHERE user_id = $1', [userId]);
  return { deleted: rowCount ?? 0 };
}
