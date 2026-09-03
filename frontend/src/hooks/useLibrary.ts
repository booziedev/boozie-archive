import { useQuery, keepPreviousData } from '@tanstack/react-query';

import { api, type ListParams } from '../lib/api';

/**
 * react-query wrappers around the API.
 *
 * `keepPreviousData` keeps the grid on screen while a filter changes, which
 * avoids the full-page skeleton flash that makes browsing feel slow.
 */

const FIVE_MINUTES = 5 * 60 * 1000;

export function useStats() {
  return useQuery({ queryKey: ['stats'], queryFn: api.stats, staleTime: FIVE_MINUTES });
}

export function useArtists(params: ListParams) {
  return useQuery({
    queryKey: ['artists', params],
    queryFn: () => api.artists(params),
    placeholderData: keepPreviousData,
    staleTime: FIVE_MINUTES,
  });
}

export function useArtist(id: string | undefined) {
  return useQuery({
    queryKey: ['artist', id],
    queryFn: () => api.artist(id!),
    enabled: Boolean(id),
    staleTime: FIVE_MINUTES,
  });
}

export function useAlbums(params: ListParams) {
  return useQuery({
    queryKey: ['albums', params],
    queryFn: () => api.albums(params),
    placeholderData: keepPreviousData,
    staleTime: FIVE_MINUTES,
  });
}

export function useAlbum(id: string | undefined) {
  return useQuery({
    queryKey: ['album', id],
    queryFn: () => api.album(id!),
    enabled: Boolean(id),
    staleTime: FIVE_MINUTES,
  });
}

export function useTracks(params: ListParams, enabled = true) {
  return useQuery({
    queryKey: ['tracks', params],
    queryFn: () => api.tracks(params),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: FIVE_MINUTES,
  });
}

export function useSearch(query: string, limit = 6) {
  return useQuery({
    queryKey: ['search', query, limit],
    queryFn: () => api.search(query, limit),
    enabled: query.trim().length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  });
}

export function useGenres() {
  return useQuery({ queryKey: ['genres'], queryFn: api.genres, staleTime: FIVE_MINUTES });
}

export function useYears() {
  return useQuery({ queryKey: ['years'], queryFn: api.years, staleTime: FIVE_MINUTES });
}

export function useRecentAlbums(limit = 18) {
  return useQuery({
    queryKey: ['recent', limit],
    queryFn: () => api.recent(limit),
    staleTime: FIVE_MINUTES,
  });
}
