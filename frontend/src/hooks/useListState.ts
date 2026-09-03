import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import type { SortKey } from '../lib/types';

const SORT_KEYS: SortKey[] = ['name', 'recent', 'tracks', 'year', 'duration', 'random'];

export interface ListState {
  q: string;
  genre: string;
  year: number | '';
  sort: SortKey;
  limit: number;
}

/**
 * Keeps list filters in the URL.
 *
 * Sharing a filtered view or hitting back/forward then behaves exactly as a
 * visitor expects, and the query string doubles as the react-query cache key.
 */
export function useListState(defaultSort: SortKey = 'name', pageSize = 60) {
  const [params, setParams] = useSearchParams();

  const state = useMemo<ListState>(() => {
    const rawSort = params.get('sort');
    const rawYear = Number.parseInt(params.get('year') ?? '', 10);
    const rawLimit = Number.parseInt(params.get('limit') ?? '', 10);
    return {
      q: params.get('q') ?? '',
      genre: params.get('genre') ?? '',
      year: Number.isFinite(rawYear) ? rawYear : '',
      sort: rawSort && SORT_KEYS.includes(rawSort as SortKey) ? (rawSort as SortKey) : defaultSort,
      limit: Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : pageSize,
    };
  }, [params, defaultSort, pageSize]);

  const update = useCallback(
    (patch: Partial<ListState>) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(patch)) {
            if (value === '' || value === undefined || value === null) next.delete(key);
            else next.set(key, String(value));
          }
          // Any filter change resets pagination.
          if (!('limit' in patch)) next.delete('limit');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const showMore = useCallback(
    () => update({ limit: state.limit + pageSize }),
    [pageSize, state.limit, update],
  );

  return { state, update, showMore, pageSize };
}
