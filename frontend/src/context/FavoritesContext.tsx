import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { favourites as api } from '../lib/api';
import { useAuth } from './AuthContext';
import type { FavouriteKind, Favourites } from '../lib/types';

/**
 * Favourites, kept by the server.
 *
 * These lived in localStorage until now, which quietly made them per-browser
 * rather than per-person — a heart on your phone was invisible on your laptop,
 * and the page had to admit it in its own subtitle. They follow the account
 * now.
 *
 * The old key is still read once, so nobody loses what they had. See
 * `useImportOnce` below.
 */

/** Where favourites used to live. Read once on upgrade, then removed. */
const LEGACY_KEY = 'boozie.favourites.v1';

export type FavoriteKind = FavouriteKind;

interface FavoritesState {
  track: string[];
  album: string[];
  artist: string[];
}

const EMPTY: FavoritesState = { track: [], album: [], artist: [] };
const EMPTY_ITEMS: Favourites['items'] = { tracks: [], albums: [], artists: [] };

interface FavoritesContextValue {
  favorites: FavoritesState;
  /** The same things resolved, for anything that renders them as cards. */
  items: Favourites['items'];
  isFavorite: (kind: FavoriteKind, id: string) => boolean;
  toggle: (kind: FavoriteKind, id: string) => void;
  count: (kind: FavoriteKind) => number;
  clear: () => void;
  /** False until the first fetch lands, so callers can hold off on empty states. */
  ready: boolean;
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

export const FAVOURITES_KEY = ['favourites'] as const;

/** Whatever the old localStorage key holds, or null when there is nothing. */
function readLegacy(): Partial<FavoritesState> | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FavoritesState>;
    const ids = {
      track: Array.isArray(parsed.track) ? parsed.track : [],
      album: Array.isArray(parsed.album) ? parsed.album : [],
      artist: Array.isArray(parsed.artist) ? parsed.artist : [],
    };
    const total = ids.track.length + ids.album.length + ids.artist.length;
    return total > 0 ? ids : null;
  } catch {
    return null;
  }
}

function forget() {
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Storage disabled — nothing to clean up.
  }
}

/**
 * Moves this browser's old favourites onto the account, once.
 *
 * The server merges rather than replaces, so running this on a phone and again
 * on a laptop ends with both sets on the account instead of one overwriting the
 * other — which is what somebody with two devices actually wants. Removing the
 * key afterwards is what makes it a one-off; the merge being idempotent is what
 * makes a double run harmless anyway.
 *
 * One honest caveat: favourites hearted while signed out land on whichever
 * account signs in next. On a shared browser that is the wrong account. It is a
 * one-time, low-stakes mistake that un-hearting fixes, and there is no signal
 * that would tell the two cases apart.
 */
function useImportOnce(signedIn: boolean) {
  const queryClient = useQueryClient();
  const done = useRef(false);

  useEffect(() => {
    if (!signedIn || done.current) return;
    const legacy = readLegacy();
    if (!legacy) {
      done.current = true;
      return;
    }

    done.current = true;
    api
      .import(legacy)
      .then((result) => {
        forget();
        queryClient.setQueryData(FAVOURITES_KEY, result.favourites);
      })
      // Left in place on failure, so the next load tries again.
      .catch(() => undefined);
  }, [signedIn, queryClient]);
}

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const signedIn = Boolean(user);

  useImportOnce(signedIn);

  const query = useQuery({
    queryKey: FAVOURITES_KEY,
    queryFn: api.list,
    enabled: signedIn,
    staleTime: 30_000,
  });

  const favourites = query.data?.favourites;
  const favorites = (favourites?.ids as FavoritesState | undefined) ?? EMPTY;
  const items = favourites?.items ?? EMPTY_ITEMS;

  /**
   * Hearting has to feel instant — it is the most-tapped control in the app —
   * so the cache is updated before the request goes out and rolled back if it
   * fails. The server returns the whole set, which is what lands in the end.
   */
  const mutation = useMutation({
    mutationFn: ({ kind, id, on }: { kind: FavoriteKind; id: string; on: boolean }) =>
      on ? api.add(kind, id) : api.remove(kind, id),
    onMutate: async ({ kind, id, on }) => {
      await queryClient.cancelQueries({ queryKey: FAVOURITES_KEY });
      const previous = queryClient.getQueryData<{ favourites: Favourites }>(FAVOURITES_KEY);

      queryClient.setQueryData<{ favourites: Favourites }>(FAVOURITES_KEY, (old) => {
        if (!old) return old;
        const list = old.favourites.ids[kind];
        return {
          favourites: {
            ...old.favourites,
            ids: {
              ...old.favourites.ids,
              [kind]: on ? [id, ...list.filter((one) => one !== id)] : list.filter((one) => one !== id),
            },
          },
        };
      });

      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(FAVOURITES_KEY, context.previous);
    },
    onSuccess: (result) => queryClient.setQueryData(FAVOURITES_KEY, result),
    // The optimistic write only moved ids; a refetch brings the resolved
    // entities the Library renders back into line.
    onSettled: () => queryClient.invalidateQueries({ queryKey: FAVOURITES_KEY }),
  });

  const clearAll = useMutation({
    mutationFn: api.clear,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: FAVOURITES_KEY }),
  });

  const toggle = useCallback(
    (kind: FavoriteKind, id: string) => {
      if (!signedIn) return;
      const on = !(queryClient.getQueryData<{ favourites: Favourites }>(FAVOURITES_KEY)
        ?.favourites.ids[kind]
        .includes(id));
      mutation.mutate({ kind, id, on });
    },
    [signedIn, queryClient, mutation],
  );

  const value = useMemo<FavoritesContextValue>(
    () => ({
      favorites,
      items,
      isFavorite: (kind, id) => favorites[kind].includes(id),
      toggle,
      count: (kind) => favorites[kind].length,
      clear: () => clearAll.mutate(),
      ready: !signedIn || query.isSuccess,
    }),
    [favorites, items, toggle, clearAll, signedIn, query.isSuccess],
  );

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites(): FavoritesContextValue {
  const context = useContext(FavoritesContext);
  if (!context) throw new Error('useFavorites must be used inside <FavoritesProvider>');
  return context;
}
