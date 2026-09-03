import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * Client-side favourites, persisted to localStorage.
 *
 * Only ids are stored (they are stable across rescans), so the payload stays
 * tiny and a future server-side sync can reuse the same shape.
 */
const STORAGE_KEY = 'boozie.favourites.v1';

export type FavoriteKind = 'track' | 'album' | 'artist';

interface FavoritesState {
  track: string[];
  album: string[];
  artist: string[];
}

const EMPTY: FavoritesState = { track: [], album: [], artist: [] };

interface FavoritesContextValue {
  favorites: FavoritesState;
  isFavorite: (kind: FavoriteKind, id: string) => boolean;
  toggle: (kind: FavoriteKind, id: string) => void;
  count: (kind: FavoriteKind) => number;
  clear: () => void;
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

function read(): FavoritesState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<FavoritesState>;
    return {
      track: Array.isArray(parsed.track) ? parsed.track : [],
      album: Array.isArray(parsed.album) ? parsed.album : [],
      artist: Array.isArray(parsed.artist) ? parsed.artist : [],
    };
  } catch {
    return EMPTY;
  }
}

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [favorites, setFavorites] = useState<FavoritesState>(read);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
    } catch {
      // Storage full or disabled — favourites simply won't persist.
    }
  }, [favorites]);

  // Keep multiple tabs (or the PWA plus Safari) in sync.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setFavorites(read());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const toggle = useCallback((kind: FavoriteKind, id: string) => {
    setFavorites((current) => {
      const list = current[kind];
      const next = list.includes(id) ? list.filter((item) => item !== id) : [id, ...list];
      return { ...current, [kind]: next };
    });
  }, []);

  const value = useMemo<FavoritesContextValue>(
    () => ({
      favorites,
      isFavorite: (kind, id) => favorites[kind].includes(id),
      toggle,
      count: (kind) => favorites[kind].length,
      clear: () => setFavorites(EMPTY),
    }),
    [favorites, toggle],
  );

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites(): FavoritesContextValue {
  const context = useContext(FavoritesContext);
  if (!context) throw new Error('useFavorites must be used inside <FavoritesProvider>');
  return context;
}
