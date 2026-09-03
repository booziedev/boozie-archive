/**
 * Shared data model for the library index.
 *
 * The index is intentionally flat (three arrays + lookup maps) so it can be
 * serialised to a single JSON file, loaded in one read on boot, and queried
 * in memory without a database round trip. For 100k+ tracks this stays in the
 * low hundreds of MB of JSON on disk and loads in a couple of seconds.
 */

/** Where the cover art for an album/artist comes from. */
export type CoverSource =
  /** Picture embedded in the tags of a specific track. */
  | { kind: 'embedded'; trackId: string }
  /** Image file sitting next to the audio (cover.jpg, folder.png, ...). */
  | { kind: 'file'; path: string };

export interface Track {
  id: string;
  /** Path relative to MUSIC_ROOT. Always POSIX separators. */
  path: string;
  title: string;
  artist: string;
  artistId: string;
  albumArtist: string;
  album: string;
  albumId: string;
  trackNo: number | null;
  discNo: number | null;
  year: number | null;
  genres: string[];
  /** Seconds. */
  duration: number | null;
  /** Bits per second. */
  bitrate: number | null;
  /** Hz, e.g. 44100. */
  sampleRate: number | null;
  bitsPerSample: number | null;
  channels: number | null;
  codec: string | null;
  container: string | null;
  lossless: boolean;
  /** File extension without the dot, lowercased. */
  ext: string;
  /** Bytes. */
  size: number;
  /** File mtime in ms — used for incremental rescans and "recently added". */
  mtimeMs: number;
  hasEmbeddedCover: boolean;
  /** Which entity owns the artwork used for this track (usually its album). */
  coverId: string | null;
}

export interface Album {
  id: string;
  name: string;
  artistId: string;
  artistName: string;
  year: number | null;
  genres: string[];
  trackCount: number;
  /** Sum of track durations in seconds. */
  duration: number;
  /** Distinct file extensions in the album, e.g. ["flac", "mp3"]. */
  formats: string[];
  /** True when every track in the album is a lossless format. */
  lossless: boolean;
  /** Newest track mtime — powers the "recently added" rail. */
  addedAt: number;
  /** Album folder relative to MUSIC_ROOT (best-effort, for display/debug). */
  folder: string;
  hasCover: boolean;
}

export interface Artist {
  id: string;
  name: string;
  albumCount: number;
  trackCount: number;
  duration: number;
  genres: string[];
  addedAt: number;
  hasCover: boolean;
}

export interface LibraryIndex {
  /** Bumped when the shape below changes so stale caches are discarded. */
  version: number;
  root: string;
  scannedAt: string;
  /** How long the last full scan took, in ms. */
  scanDurationMs: number;
  artists: Artist[];
  albums: Album[];
  tracks: Track[];
  /** Cover art sources keyed by album/artist id. Not exposed over the API. */
  covers: Record<string, CoverSource>;
}

export interface LibraryStats {
  artists: number;
  albums: number;
  tracks: number;
  /** Total playtime in seconds. */
  duration: number;
  /** Total size on disk in bytes. */
  size: number;
  formats: { ext: string; count: number }[];
  genres: number;
  scannedAt: string | null;
  scanning: boolean;
}
