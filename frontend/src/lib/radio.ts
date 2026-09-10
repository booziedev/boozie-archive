import type { Station, Track } from './types';

/**
 * Radio, as far as the rest of the app is concerned.
 *
 * A station is dressed up as a `Track` so it can go through the player, the
 * queue, the Media Session widget and the listening-status heartbeat without
 * any of them needing a second code path. What makes it different is the id:
 * every id in this app is two letters and an underscore, and `rd_` is the one
 * that means "live" — no duration, no seeking, and never written to the play
 * log.
 */

export function isRadioId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith('rd_');
}

export function isRadio(track: { id: string } | null | undefined): boolean {
  return isRadioId(track?.id);
}

/**
 * Builds the pseudo-track for a station.
 *
 * `duration: null` is the load-bearing field: the seek bar, the crossfade
 * trigger and the scrobble threshold are all already guarded on a real
 * duration, so a station falls out of each of them without a special case.
 */
export function radioTrack(station: Station): Track {
  return {
    id: station.id,
    path: '',
    title: station.name,
    // Shown wherever a track would name its artist. "Radio" reads better than
    // an empty string in the queue and on the lock screen.
    artist: 'Radio',
    artistId: '',
    albumArtist: 'Radio',
    album: station.country ?? 'Radio',
    albumId: '',
    trackNo: null,
    discNo: null,
    year: null,
    genres: station.tags,
    duration: null,
    bitrate: station.bitrate ? station.bitrate * 1000 : null,
    sampleRate: null,
    bitsPerSample: null,
    channels: null,
    codec: station.codec,
    container: null,
    lossless: false,
    ext: station.codec?.toLowerCase() === 'aac' ? 'aac' : 'mp3',
    size: 0,
    mtimeMs: 0,
    hasEmbeddedCover: false,
    coverId: null,
  };
}
