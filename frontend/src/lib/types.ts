/** Mirrors the backend data model in backend/src/types.ts. */

export interface Track {
  id: string;
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
  duration: number | null;
  bitrate: number | null;
  sampleRate: number | null;
  bitsPerSample: number | null;
  channels: number | null;
  codec: string | null;
  container: string | null;
  lossless: boolean;
  ext: string;
  size: number;
  mtimeMs: number;
  hasEmbeddedCover: boolean;
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
  duration: number;
  formats: string[];
  lossless: boolean;
  addedAt: number;
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

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface LibraryStats {
  artists: number;
  albums: number;
  tracks: number;
  duration: number;
  size: number;
  formats: { ext: string; count: number }[];
  genres: number;
  scannedAt: string | null;
  scanning: boolean;
}

export interface SearchResults {
  query: string;
  artists: Artist[];
  albums: Album[];
  tracks: Track[];
}

export interface AlbumDetail {
  album: Album;
  artist: Artist | null;
  tracks: Track[];
}

export interface ArtistDetail {
  artist: Artist;
  albums: Album[];
}

export type SortKey = 'name' | 'recent' | 'tracks' | 'year' | 'duration' | 'random';
