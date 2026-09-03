import fs from 'node:fs/promises';
import path from 'node:path';

import { config } from '../config.js';
import { INDEX_VERSION, scanLibrary, type ScanProgress } from './scanner.js';
import { foldForSearch } from './text.js';
import type { Album, Artist, LibraryIndex, LibraryStats, Track } from '../types.js';

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export type SortKey = 'name' | 'recent' | 'tracks' | 'year' | 'duration' | 'random';

export interface ListQuery {
  q?: string;
  genre?: string;
  year?: number;
  sort?: SortKey;
  limit?: number;
  offset?: number;
}

const EMPTY_INDEX: LibraryIndex = {
  version: INDEX_VERSION,
  root: config.musicRoot,
  scannedAt: new Date(0).toISOString(),
  scanDurationMs: 0,
  artists: [],
  albums: [],
  tracks: [],
  covers: {},
};

/**
 * In-memory library with the lookup maps and folded search strings the API
 * needs. Everything is rebuilt from the index in `hydrate()`, which is the only
 * place that has to run when a rescan finishes.
 */
export class Library {
  private index: LibraryIndex = EMPTY_INDEX;

  private artistsById = new Map<string, Artist>();
  private albumsById = new Map<string, Album>();
  private tracksById = new Map<string, Track>();
  private albumsByArtist = new Map<string, Album[]>();
  private tracksByAlbum = new Map<string, Track[]>();
  private tracksByArtist = new Map<string, Track[]>();

  /** Lower-cased, accent-folded haystacks for substring search. */
  private artistSearch = new Map<string, string>();
  private albumSearch = new Map<string, string>();
  private trackSearch = new Map<string, string>();

  private genreCounts = new Map<string, number>();
  private yearCounts = new Map<number, number>();
  private formatCounts = new Map<string, number>();
  private totalSize = 0;
  private totalDuration = 0;

  private loadedFromDisk = false;

  readonly progress: ScanProgress = {
    scanning: false,
    startedAt: null,
    finishedAt: null,
    filesFound: 0,
    filesParsed: 0,
    filesReused: 0,
    errors: 0,
    currentFile: null,
  };

  private scanPromise: Promise<LibraryIndex> | null = null;

  get snapshot(): LibraryIndex {
    return this.index;
  }

  get isEmpty(): boolean {
    return this.index.tracks.length === 0;
  }

  get hasPersistedIndex(): boolean {
    return this.loadedFromDisk;
  }

  /** Loads a previously persisted index, if one exists and is compatible. */
  async loadFromDisk(logger?: { info: (m: string) => void; warn: (m: string) => void }) {
    try {
      const raw = await fs.readFile(config.indexFile, 'utf8');
      const parsed = JSON.parse(raw) as LibraryIndex;
      if (parsed.version !== INDEX_VERSION) {
        logger?.warn(
          `Cached index version ${parsed.version} != ${INDEX_VERSION}; a full rescan is required.`,
        );
        return false;
      }
      this.hydrate(parsed);
      this.loadedFromDisk = true;
      logger?.info(
        `Loaded cached index: ${parsed.tracks.length} tracks / ${parsed.albums.length} albums ` +
          `(scanned ${parsed.scannedAt}).`,
      );
      return true;
    } catch {
      return false;
    }
  }

  private async persist() {
    await fs.mkdir(path.dirname(config.indexFile), { recursive: true });
    const tmp = `${config.indexFile}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.index), 'utf8');
    await fs.rename(tmp, config.indexFile); // atomic swap, never a half-written index
    this.loadedFromDisk = true;
  }

  /** Runs a scan; concurrent callers share the same in-flight promise. */
  async rescan(logger?: { info: (m: string) => void; warn: (m: string) => void }) {
    if (this.scanPromise) return this.scanPromise;

    this.progress.scanning = true;
    this.progress.startedAt = Date.now();
    this.progress.finishedAt = null;
    this.progress.filesFound = 0;
    this.progress.filesParsed = 0;
    this.progress.filesReused = 0;
    this.progress.errors = 0;

    this.scanPromise = scanLibrary({
      root: config.musicRoot,
      concurrency: config.scanConcurrency,
      followSymlinks: config.followSymlinks,
      previous: this.index,
      progress: this.progress,
      logger,
    })
      .then(async (next) => {
        this.hydrate(next);
        await this.persist();
        return next;
      })
      .finally(() => {
        this.progress.scanning = false;
        this.progress.finishedAt = Date.now();
        this.progress.currentFile = null;
        this.scanPromise = null;
      });

    return this.scanPromise;
  }

  /** Rebuilds every derived lookup structure from a fresh index. */
  hydrate(index: LibraryIndex) {
    this.index = index;
    this.artistsById = new Map();
    this.albumsById = new Map();
    this.tracksById = new Map();
    this.albumsByArtist = new Map();
    this.tracksByAlbum = new Map();
    this.tracksByArtist = new Map();
    this.artistSearch = new Map();
    this.albumSearch = new Map();
    this.trackSearch = new Map();
    this.genreCounts = new Map();
    this.yearCounts = new Map();
    this.formatCounts = new Map();
    this.totalSize = 0;
    this.totalDuration = 0;

    for (const artist of index.artists) {
      this.artistsById.set(artist.id, artist);
      this.artistSearch.set(artist.id, foldForSearch(artist.name));
    }

    for (const album of index.albums) {
      this.albumsById.set(album.id, album);
      this.albumSearch.set(album.id, foldForSearch(`${album.name} ${album.artistName}`));
      const list = this.albumsByArtist.get(album.artistId);
      if (list) list.push(album);
      else this.albumsByArtist.set(album.artistId, [album]);
      if (album.year) this.yearCounts.set(album.year, (this.yearCounts.get(album.year) ?? 0) + 1);
    }

    for (const track of index.tracks) {
      this.tracksById.set(track.id, track);
      this.trackSearch.set(
        track.id,
        foldForSearch(`${track.title} ${track.artist} ${track.album} ${track.albumArtist}`),
      );

      const albumTracks = this.tracksByAlbum.get(track.albumId);
      if (albumTracks) albumTracks.push(track);
      else this.tracksByAlbum.set(track.albumId, [track]);

      const artistTracks = this.tracksByArtist.get(track.artistId);
      if (artistTracks) artistTracks.push(track);
      else this.tracksByArtist.set(track.artistId, [track]);

      this.totalSize += track.size;
      this.totalDuration += track.duration ?? 0;
      this.formatCounts.set(track.ext, (this.formatCounts.get(track.ext) ?? 0) + 1);
      for (const genre of track.genres) {
        this.genreCounts.set(genre, (this.genreCounts.get(genre) ?? 0) + 1);
      }
    }

    // Album track lists are served in playback order.
    for (const tracks of this.tracksByAlbum.values()) tracks.sort(compareTrackOrder);
    for (const albums of this.albumsByArtist.values()) {
      albums.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.name.localeCompare(b.name));
    }
  }

  // ---------------------------------------------------------------- queries

  stats(): LibraryStats {
    return {
      artists: this.index.artists.length,
      albums: this.index.albums.length,
      tracks: this.index.tracks.length,
      duration: Math.round(this.totalDuration),
      size: this.totalSize,
      formats: [...this.formatCounts.entries()]
        .map(([ext, count]) => ({ ext, count }))
        .sort((a, b) => b.count - a.count),
      genres: this.genreCounts.size,
      scannedAt: this.index.tracks.length > 0 ? this.index.scannedAt : null,
      scanning: this.progress.scanning,
    };
  }

  genres(): { name: string; count: number }[] {
    return [...this.genreCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  years(): { year: number; count: number }[] {
    return [...this.yearCounts.entries()]
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => b.year - a.year);
  }

  getArtist(id: string): Artist | undefined {
    return this.artistsById.get(id);
  }

  getAlbum(id: string): Album | undefined {
    return this.albumsById.get(id);
  }

  getTrack(id: string): Track | undefined {
    return this.tracksById.get(id);
  }

  albumsOfArtist(id: string): Album[] {
    return this.albumsByArtist.get(id) ?? [];
  }

  tracksOfAlbum(id: string): Track[] {
    return this.tracksByAlbum.get(id) ?? [];
  }

  tracksOfArtist(id: string): Track[] {
    return this.tracksByArtist.get(id) ?? [];
  }

  coverSource(id: string) {
    return this.index.covers[id];
  }

  listArtists(query: ListQuery): Page<Artist> {
    const needle = query.q ? foldForSearch(query.q) : null;
    let items = this.index.artists;

    if (needle) items = items.filter((a) => this.artistSearch.get(a.id)?.includes(needle));
    if (query.genre) {
      const genre = query.genre.toLowerCase();
      items = items.filter((a) => a.genres.some((g) => g.toLowerCase() === genre));
    }

    return paginate(sortEntities(items, query.sort ?? 'name'), query);
  }

  listAlbums(query: ListQuery & { artistId?: string }): Page<Album> {
    const needle = query.q ? foldForSearch(query.q) : null;
    let items = query.artistId ? this.albumsOfArtist(query.artistId) : this.index.albums;

    if (needle) items = items.filter((a) => this.albumSearch.get(a.id)?.includes(needle));
    if (query.genre) {
      const genre = query.genre.toLowerCase();
      items = items.filter((a) => a.genres.some((g) => g.toLowerCase() === genre));
    }
    if (query.year) items = items.filter((a) => a.year === query.year);

    return paginate(sortEntities(items, query.sort ?? 'name'), query);
  }

  listTracks(query: ListQuery & { artistId?: string; albumId?: string }): Page<Track> {
    const needle = query.q ? foldForSearch(query.q) : null;
    let items: Track[];
    if (query.albumId) items = this.tracksOfAlbum(query.albumId);
    else if (query.artistId) items = this.tracksOfArtist(query.artistId);
    else items = this.index.tracks;

    if (needle) items = items.filter((t) => this.trackSearch.get(t.id)?.includes(needle));
    if (query.genre) {
      const genre = query.genre.toLowerCase();
      items = items.filter((t) => t.genres.some((g) => g.toLowerCase() === genre));
    }
    if (query.year) items = items.filter((t) => t.year === query.year);

    const sort = query.sort ?? (query.albumId ? 'name' : 'name');
    const sorted =
      query.albumId && sort === 'name'
        ? [...items].sort(compareTrackOrder)
        : sortEntities(items, sort);

    return paginate(sorted, query);
  }

  /** Combined search used by the header search bar. */
  search(q: string, limit = 8) {
    return {
      artists: this.listArtists({ q, limit }).items,
      albums: this.listAlbums({ q, limit }).items,
      tracks: this.listTracks({ q, limit }).items,
    };
  }

  /** Most recently added albums (by newest file mtime in the album). */
  recentAlbums(limit = 18): Album[] {
    return [...this.index.albums].sort((a, b) => b.addedAt - a.addedAt).slice(0, limit);
  }
}

/** Album track ordering: disc, then track number, then filename. */
function compareTrackOrder(a: Track, b: Track): number {
  const discA = a.discNo ?? 1;
  const discB = b.discNo ?? 1;
  if (discA !== discB) return discA - discB;
  const trackA = a.trackNo ?? Number.MAX_SAFE_INTEGER;
  const trackB = b.trackNo ?? Number.MAX_SAFE_INTEGER;
  if (trackA !== trackB) return trackA - trackB;
  return a.path.localeCompare(b.path);
}

type SortableEntity = Artist | Album | Track;

function sortEntities<T extends SortableEntity>(items: T[], sort: SortKey): T[] {
  const copy = [...items];
  switch (sort) {
    case 'recent':
      return copy.sort((a, b) => addedAt(b) - addedAt(a));
    case 'tracks':
      return copy.sort((a, b) => trackCount(b) - trackCount(a) || label(a).localeCompare(label(b)));
    case 'year':
      return copy.sort((a, b) => (year(b) ?? 0) - (year(a) ?? 0) || label(a).localeCompare(label(b)));
    case 'duration':
      return copy.sort((a, b) => (duration(b) ?? 0) - (duration(a) ?? 0));
    case 'random':
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j]!, copy[i]!];
      }
      return copy;
    case 'name':
    default:
      return copy.sort((a, b) => label(a).localeCompare(label(b), undefined, { numeric: true }));
  }
}

function label(entity: SortableEntity): string {
  return 'title' in entity ? entity.title : entity.name;
}
function addedAt(entity: SortableEntity): number {
  return 'mtimeMs' in entity ? entity.mtimeMs : entity.addedAt;
}
function trackCount(entity: SortableEntity): number {
  return 'trackCount' in entity ? entity.trackCount : 1;
}
function year(entity: SortableEntity): number | null {
  return 'year' in entity ? entity.year : null;
}
function duration(entity: SortableEntity): number | null {
  return entity.duration ?? 0;
}

function paginate<T>(items: T[], query: ListQuery): Page<T> {
  const limit = clampInt(query.limit ?? 60, 1, 1000);
  const offset = clampInt(query.offset ?? 0, 0, Number.MAX_SAFE_INTEGER);
  return { items: items.slice(offset, offset + limit), total: items.length, limit, offset };
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export const library = new Library();
