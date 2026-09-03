import fs from 'node:fs/promises';
import path from 'node:path';
import { parseFile, type IAudioMetadata } from 'music-metadata';

import {
  AUDIO_EXTENSIONS,
  COVER_EXTENSIONS,
  COVER_FILENAMES,
  LOSSLESS_EXTENSIONS,
} from '../config.js';
import { albumId as makeAlbumId, artistId as makeArtistId, trackId as makeTrackId } from './ids.js';
import { clean, parseAlbumFolder, splitGenres, titleFromFilename } from './text.js';
import type { Album, Artist, CoverSource, LibraryIndex, Track } from '../types.js';

/** Bumped whenever the on-disk index shape changes. */
export const INDEX_VERSION = 3;

/** Directories that never contain music worth indexing. */
const SKIPPED_DIRS = new Set([
  '@eadir',
  '.git',
  '.svn',
  'node_modules',
  '.trash',
  '.trash-1000',
  '$recycle.bin',
  'system volume information',
  '.spotlight-v100',
  '.fseventsd',
  '.ds_store',
]);

/** "CD1", "Disc 2", "disk 03" — treated as part of the album above them. */
const DISC_FOLDER_RE = /^(cd|disc|disk|dvd|vol(?:ume)?)\.?[\s_-]*(\d{1,2})$/i;

export interface ScanProgress {
  scanning: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  filesFound: number;
  filesParsed: number;
  filesReused: number;
  errors: number;
  currentFile: string | null;
}

export interface DiscoveredFile {
  abs: string;
  /** POSIX-style path relative to the library root. */
  rel: string;
  size: number;
  mtimeMs: number;
}

interface WalkResult {
  audio: DiscoveredFile[];
  /** relative directory -> image filenames found in it (priority sorted). */
  imagesByDir: Map<string, string[]>;
}

function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx === -1 ? '' : filename.slice(idx + 1).toLowerCase();
}

/** Ranks candidate artwork files: cover.jpg beats back.png beats random.jpg. */
function coverPriority(filename: string): number {
  const base = filename.slice(0, filename.lastIndexOf('.')).toLowerCase();
  const idx = COVER_FILENAMES.findIndex((name) => base === name || base.startsWith(name));
  if (idx !== -1) return idx;
  if (/back|cd|disc|inlay|booklet/.test(base)) return COVER_FILENAMES.length + 10;
  return COVER_FILENAMES.length;
}

/**
 * Recursively walks the collection collecting audio files and candidate cover
 * images. Errors on individual directories (permissions, unplugged drives on a
 * subpath) are logged and skipped so a single bad folder can't kill a scan.
 */
export async function walkLibrary(
  root: string,
  options: { followSymlinks: boolean; onFile?: (count: number) => void },
): Promise<WalkResult> {
  const audio: DiscoveredFile[] = [];
  const imagesByDir = new Map<string, string[]>();
  const queue: string[] = [root];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const dir = queue.pop()!;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    const relDir = path.relative(root, dir).split(path.sep).join('/');
    const images: string[] = [];

    for (const entry of entries) {
      const name = entry.name;
      if (name.startsWith('._')) continue; // macOS resource forks

      const abs = path.join(dir, name);
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();

      if (entry.isSymbolicLink()) {
        if (!options.followSymlinks) continue;
        try {
          const stat = await fs.stat(abs);
          isDir = stat.isDirectory();
          isFile = stat.isFile();
        } catch {
          continue;
        }
      }

      if (isDir) {
        if (name.startsWith('.') || SKIPPED_DIRS.has(name.toLowerCase())) continue;
        let realPath = abs;
        if (options.followSymlinks) {
          try {
            realPath = await fs.realpath(abs);
          } catch {
            realPath = abs;
          }
          if (visited.has(realPath)) continue; // symlink loop guard
          visited.add(realPath);
        }
        queue.push(abs);
        continue;
      }

      if (!isFile) continue;
      const ext = extensionOf(name);

      if (COVER_EXTENSIONS.includes(ext)) {
        images.push(name);
        continue;
      }
      if (!AUDIO_EXTENSIONS.has(ext)) continue;

      try {
        const stat = await fs.stat(abs);
        if (stat.size === 0) continue;
        audio.push({
          abs,
          rel: relDir ? `${relDir}/${name}` : name,
          size: stat.size,
          mtimeMs: Math.round(stat.mtimeMs),
        });
        options.onFile?.(audio.length);
      } catch {
        // File vanished between readdir and stat — ignore.
      }
    }

    if (images.length > 0) {
      images.sort((a, b) => coverPriority(a) - coverPriority(b) || a.localeCompare(b));
      imagesByDir.set(relDir, images);
    }
  }

  audio.sort((a, b) => a.rel.localeCompare(b.rel));
  return { audio, imagesByDir };
}

/**
 * Splits a relative path into the folder names that describe it, collapsing
 * "CD1"/"Disc 2" subfolders into their parent album.
 */
function folderContext(rel: string): {
  fileName: string;
  albumFolder: string;
  artistFolder: string;
  albumDir: string;
  /** Disc number recovered from a "CD2"/"Disc 2" subfolder, if any. */
  discNo: number | null;
} {
  const segments = rel.split('/');
  const fileName = segments[segments.length - 1] ?? rel;
  const dirs = segments.slice(0, -1);

  let albumIdx = dirs.length - 1;
  let discNo: number | null = null;

  const discMatch = albumIdx >= 1 ? DISC_FOLDER_RE.exec(dirs[albumIdx] ?? '') : null;
  if (discMatch) {
    const parsed = Number.parseInt(discMatch[2]!, 10);
    discNo = Number.isFinite(parsed) ? parsed : null;
    albumIdx -= 1;
  }

  const albumFolder = albumIdx >= 0 ? dirs[albumIdx]! : '';
  const artistFolder = albumIdx >= 1 ? dirs[albumIdx - 1]! : '';
  const albumDir = dirs.slice(0, albumIdx + 1).join('/');

  return { fileName, albumFolder, artistFolder, albumDir, discNo };
}

/** Reads the leading track number of filenames like "07 - Song.flac". */
function trackNoFromFilename(fileName: string): number | null {
  const match = /^\s*(\d{1,3})\s*[-._) ]/.exec(fileName);
  if (!match) return null;
  const n = Number.parseInt(match[1]!, 10);
  return Number.isFinite(n) && n > 0 && n < 500 ? n : null;
}

/**
 * Builds a Track from file stats + parsed tags, falling back to the folder
 * structure whenever a tag is missing. This is the heart of "prefer metadata
 * but respect folders".
 */
export function buildTrack(file: DiscoveredFile, meta: IAudioMetadata | null): Track {
  const { fileName, albumFolder, artistFolder, discNo: folderDiscNo } = folderContext(file.rel);
  const folderAlbum = albumFolder ? parseAlbumFolder(albumFolder) : { name: '', year: null };

  const common = meta?.common;
  const format = meta?.format;

  const title = clean(common?.title) ?? titleFromFilename(fileName);
  const artist =
    clean(common?.artist) ??
    clean(common?.artists?.[0]) ??
    clean(common?.albumartist) ??
    clean(artistFolder) ??
    'Unknown Artist';
  const albumArtist =
    clean(common?.albumartist) ?? clean(artistFolder) ?? clean(common?.artist) ?? artist;
  const album =
    clean(common?.album) ?? (folderAlbum.name ? folderAlbum.name : null) ?? 'Unknown Album';

  const year = common?.year ?? folderAlbum.year ?? null;
  const ext = extensionOf(fileName);

  const id = makeTrackId(file.rel);
  const artistIdValue = makeArtistId(albumArtist);
  const albumIdValue = makeAlbumId(albumArtist, album);

  return {
    id,
    path: file.rel,
    title,
    artist,
    artistId: artistIdValue,
    albumArtist,
    album,
    albumId: albumIdValue,
    trackNo: common?.track?.no ?? trackNoFromFilename(fileName),
    discNo: common?.disk?.no ?? folderDiscNo,
    year: typeof year === 'number' && year > 0 ? year : null,
    genres: splitGenres(common?.genre),
    duration: format?.duration ?? null,
    bitrate: format?.bitrate ? Math.round(format.bitrate) : null,
    sampleRate: format?.sampleRate ?? null,
    bitsPerSample: format?.bitsPerSample ?? null,
    channels: format?.numberOfChannels ?? null,
    codec: clean(format?.codec) ?? null,
    container: clean(format?.container) ?? null,
    lossless: format?.lossless ?? LOSSLESS_EXTENSIONS.has(ext),
    ext,
    size: file.size,
    mtimeMs: file.mtimeMs,
    hasEmbeddedCover: (common?.picture?.length ?? 0) > 0,
    coverId: albumIdValue,
  };
}

/** Runs `worker` over `items` with a fixed number of parallel slots. */
async function pool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index]!);
    }
  });
  await Promise.all(runners);
}

export interface ScanOptions {
  root: string;
  concurrency: number;
  followSymlinks: boolean;
  /** Previous index; matching path+size+mtime entries are reused verbatim. */
  previous?: LibraryIndex | null;
  progress?: ScanProgress;
  logger?: { info: (msg: string) => void; warn: (msg: string) => void };
}

/**
 * Full library scan. Incremental in the sense that unchanged files (same path,
 * size and mtime) are copied from the previous index instead of being reparsed,
 * which turns a 20-minute cold scan into a few seconds.
 */
export async function scanLibrary(options: ScanOptions): Promise<LibraryIndex> {
  const startedAt = Date.now();
  const { root, previous, progress, logger } = options;

  const previousByPath = new Map<string, Track>();
  for (const track of previous?.tracks ?? []) previousByPath.set(track.path, track);

  logger?.info(`Scanning ${root} ...`);
  const { audio, imagesByDir } = await walkLibrary(root, {
    followSymlinks: options.followSymlinks,
    onFile: (count) => {
      if (progress) progress.filesFound = count;
    },
  });
  logger?.info(`Found ${audio.length} audio files, reading tags ...`);

  const tracks: Track[] = new Array(audio.length);
  let parsed = 0;
  let reused = 0;
  let errors = 0;

  await pool(
    audio.map((file, index) => ({ file, index })),
    options.concurrency,
    async ({ file, index }) => {
      const cached = previousByPath.get(file.rel);
      if (cached && cached.size === file.size && cached.mtimeMs === file.mtimeMs) {
        tracks[index] = cached;
        reused += 1;
        if (progress) progress.filesReused = reused;
        return;
      }

      if (progress) progress.currentFile = file.rel;
      let meta: IAudioMetadata | null = null;
      try {
        meta = await parseFile(file.abs, { duration: true, skipCovers: false });
      } catch (error) {
        errors += 1;
        if (progress) progress.errors = errors;
        logger?.warn(`Failed to read tags for ${file.rel}: ${(error as Error).message}`);
      }
      tracks[index] = buildTrack(file, meta);
      parsed += 1;
      if (progress) progress.filesParsed = parsed;
    },
  );

  const index = aggregate(root, tracks, imagesByDir, startedAt);
  logger?.info(
    `Scan complete in ${Math.round((Date.now() - startedAt) / 1000)}s — ` +
      `${index.tracks.length} tracks, ${index.albums.length} albums, ${index.artists.length} artists ` +
      `(${parsed} parsed, ${reused} reused, ${errors} errors)`,
  );
  return index;
}

/** Groups tracks into albums and artists and resolves cover art sources. */
export function aggregate(
  root: string,
  rawTracks: Track[],
  imagesByDir: Map<string, string[]>,
  startedAt: number,
): LibraryIndex {
  const tracks = rawTracks.filter(Boolean);
  const covers: Record<string, CoverSource> = {};

  interface AlbumAccumulator {
    album: Album;
    genres: Set<string>;
    formats: Set<string>;
    dirs: Map<string, number>;
  }
  const albumMap = new Map<string, AlbumAccumulator>();

  for (const track of tracks) {
    let entry = albumMap.get(track.albumId);
    if (!entry) {
      entry = {
        album: {
          id: track.albumId,
          name: track.album,
          artistId: track.artistId,
          artistName: track.albumArtist,
          year: track.year,
          genres: [],
          trackCount: 0,
          duration: 0,
          formats: [],
          lossless: true,
          addedAt: 0,
          folder: '',
          hasCover: false,
        },
        genres: new Set(),
        formats: new Set(),
        dirs: new Map(),
      };
      albumMap.set(track.albumId, entry);
    }

    entry.album.trackCount += 1;
    entry.album.duration += track.duration ?? 0;
    entry.album.addedAt = Math.max(entry.album.addedAt, track.mtimeMs);
    if (track.year && (!entry.album.year || track.year < entry.album.year)) {
      entry.album.year = track.year;
    }
    if (!track.lossless) entry.album.lossless = false;
    entry.formats.add(track.ext);
    for (const genre of track.genres) entry.genres.add(genre);

    const { albumDir } = folderContext(track.path);
    entry.dirs.set(albumDir, (entry.dirs.get(albumDir) ?? 0) + 1);

    // First track with embedded art wins; a real cover file can still override.
    if (track.hasEmbeddedCover && !covers[track.albumId]) {
      covers[track.albumId] = { kind: 'embedded', trackId: track.id };
    }
  }

  const albums: Album[] = [];
  for (const entry of albumMap.values()) {
    const album = entry.album;
    album.genres = [...entry.genres].slice(0, 12);
    album.formats = [...entry.formats].sort();
    // The folder holding most of the album's tracks is its canonical folder.
    let bestDir = '';
    let bestCount = -1;
    for (const [dir, count] of entry.dirs) {
      if (count > bestCount) {
        bestDir = dir;
        bestCount = count;
      }
    }
    album.folder = bestDir;

    // A cover image sitting in the album folder is more reliable (and higher
    // resolution) than embedded art, so it takes precedence.
    const images = imagesByDir.get(bestDir);
    if (images && images.length > 0) {
      covers[album.id] = { kind: 'file', path: bestDir ? `${bestDir}/${images[0]}` : images[0]! };
    }
    album.hasCover = Boolean(covers[album.id]);
    albums.push(album);
  }

  interface ArtistAccumulator {
    artist: Artist;
    genres: Map<string, number>;
    albums: Album[];
  }
  const artistMap = new Map<string, ArtistAccumulator>();

  for (const album of albums) {
    let entry = artistMap.get(album.artistId);
    if (!entry) {
      entry = {
        artist: {
          id: album.artistId,
          name: album.artistName,
          albumCount: 0,
          trackCount: 0,
          duration: 0,
          genres: [],
          addedAt: 0,
          hasCover: false,
        },
        genres: new Map(),
        albums: [],
      };
      artistMap.set(album.artistId, entry);
    }
    entry.artist.albumCount += 1;
    entry.artist.trackCount += album.trackCount;
    entry.artist.duration += album.duration;
    entry.artist.addedAt = Math.max(entry.artist.addedAt, album.addedAt);
    for (const genre of album.genres) {
      entry.genres.set(genre, (entry.genres.get(genre) ?? 0) + album.trackCount);
    }
    entry.albums.push(album);
  }

  const artists: Artist[] = [];
  for (const entry of artistMap.values()) {
    entry.artist.genres = [...entry.genres.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([genre]) => genre);

    // Artist artwork: a dedicated image in the artist folder, else the cover of
    // the artist's largest album.
    const sortedAlbums = [...entry.albums].sort((a, b) => b.trackCount - a.trackCount);
    const artistDir = sortedAlbums[0]?.folder.split('/').slice(0, -1).join('/') ?? '';
    const artistImages = imagesByDir.get(artistDir);
    if (artistDir && artistImages && artistImages.length > 0) {
      covers[entry.artist.id] = {
        kind: 'file',
        path: artistDir ? `${artistDir}/${artistImages[0]}` : artistImages[0]!,
      };
    } else {
      const withCover = sortedAlbums.find((album) => covers[album.id]);
      if (withCover) covers[entry.artist.id] = covers[withCover.id]!;
    }
    entry.artist.hasCover = Boolean(covers[entry.artist.id]);
    artists.push(entry.artist);
  }

  artists.sort((a, b) => a.name.localeCompare(b.name));
  albums.sort((a, b) => a.artistName.localeCompare(b.artistName) || (a.year ?? 0) - (b.year ?? 0));

  return {
    version: INDEX_VERSION,
    root,
    scannedAt: new Date().toISOString(),
    scanDurationMs: Date.now() - startedAt,
    artists,
    albums,
    tracks,
    covers,
  };
}
