import { apiUrl } from './config';
import type {
  Album,
  AlbumDetail,
  Artist,
  ArtistDetail,
  LibraryStats,
  Page,
  SearchResults,
  SortKey,
  Track,
} from './types';

/** Thrown for any non-2xx response so the UI can show a real message. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      ...init,
      headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError(
      'Could not reach the archive server. Check that the backend is running and that the API URL is correct.',
      0,
    );
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // Non-JSON error body — keep the generic message.
    }
    throw new ApiError(message, response.status);
  }

  return (await response.json()) as T;
}

export interface ListParams {
  q?: string;
  genre?: string;
  year?: number;
  sort?: SortKey;
  limit?: number;
  offset?: number;
  artistId?: string;
  albumId?: string;
}

function qs(params: ListParams = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : '';
}

export const api = {
  stats: () => request<LibraryStats>('/api/stats'),
  health: () => request<{ status: string; indexed: boolean; scanning: boolean }>('/api/health'),

  artists: (params?: ListParams) => request<Page<Artist>>(`/api/artists${qs(params)}`),
  artist: (id: string) => request<ArtistDetail>(`/api/artists/${encodeURIComponent(id)}`),
  artistTracks: (id: string, params?: ListParams) =>
    request<Page<Track>>(`/api/artists/${encodeURIComponent(id)}/tracks${qs(params)}`),

  albums: (params?: ListParams) => request<Page<Album>>(`/api/albums${qs(params)}`),
  album: (id: string) => request<AlbumDetail>(`/api/albums/${encodeURIComponent(id)}`),

  tracks: (params?: ListParams) => request<Page<Track>>(`/api/tracks${qs(params)}`),
  track: (id: string) =>
    request<{ track: Track; album: Album | null; artist: Artist | null }>(
      `/api/tracks/${encodeURIComponent(id)}`,
    ),

  search: (q: string, limit = 6) => request<SearchResults>(`/api/search${qs({ q, limit })}`),
  genres: () => request<{ name: string; count: number }[]>('/api/genres'),
  years: () => request<{ year: number; count: number }[]>('/api/years'),
  recent: (limit = 18) => request<Album[]>(`/api/recent${qs({ limit })}`),
};

/** Media URLs are used directly by <audio>/<img>, so they are plain strings. */
export const mediaUrl = {
  stream: (trackId: string) => apiUrl(`/api/stream/${encodeURIComponent(trackId)}`),
  download: (trackId: string) => apiUrl(`/api/download/${encodeURIComponent(trackId)}`),
  cover: (id: string, size: 128 | 320 | 640 = 320) =>
    apiUrl(`/api/cover/${encodeURIComponent(id)}?size=${size}`),
};
