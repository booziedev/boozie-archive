import { SlidersHorizontal, X } from 'lucide-react';

import { useGenres, useYears } from '../hooks/useLibrary';
import { formatNumber } from '../lib/format';
import type { SortKey } from '../lib/types';

interface FilterBarProps {
  query: string;
  onQueryChange: (value: string) => void;
  placeholder?: string;

  sort: SortKey;
  onSortChange: (value: SortKey) => void;
  sortOptions: { value: SortKey; label: string }[];

  genre: string;
  onGenreChange: (value: string) => void;

  /** Year filter is only meaningful for albums and tracks. */
  year?: number | '';
  onYearChange?: (value: number | '') => void;

  total?: number;
  unit?: string;
}

const selectClass =
  'appearance-none rounded-xl border border-white/10 bg-ink-850 px-3 py-2 pr-8 text-xs font-medium text-zinc-300 transition-colors hover:border-white/20 focus:border-accent-500/50 focus:outline-none';

/** Filter/sort row shared by the artists, albums and tracks pages. */
export function FilterBar({
  query,
  onQueryChange,
  placeholder = 'Filter…',
  sort,
  onSortChange,
  sortOptions,
  genre,
  onGenreChange,
  year,
  onYearChange,
  total,
  unit = 'results',
}: FilterBarProps) {
  const { data: genres } = useGenres();
  const { data: years } = useYears();
  const hasFilters = Boolean(query || genre || year);

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2.5">
      <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          autoComplete="off"
          className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 transition-colors focus:border-accent-500/50 focus:bg-white/[0.07] focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
      </div>

      <div className="relative">
        <SlidersHorizontal
          size={13}
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600"
        />
        <select
          value={sort}
          onChange={(event) => onSortChange(event.target.value as SortKey)}
          aria-label="Sort by"
          className={selectClass}
        >
          {sortOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <select
        value={genre}
        onChange={(event) => onGenreChange(event.target.value)}
        aria-label="Filter by genre"
        className={selectClass}
      >
        <option value="">All genres</option>
        {genres?.slice(0, 200).map((item) => (
          <option key={item.name} value={item.name}>
            {item.name} ({item.count})
          </option>
        ))}
      </select>

      {onYearChange && (
        <select
          value={year ?? ''}
          onChange={(event) => onYearChange(event.target.value ? Number(event.target.value) : '')}
          aria-label="Filter by year"
          className={selectClass}
        >
          <option value="">All years</option>
          {years?.map((item) => (
            <option key={item.year} value={item.year}>
              {item.year} ({item.count})
            </option>
          ))}
        </select>
      )}

      {hasFilters && (
        <button
          type="button"
          onClick={() => {
            onQueryChange('');
            onGenreChange('');
            onYearChange?.('');
          }}
          className="inline-flex items-center gap-1 rounded-xl border border-white/10 px-2.5 py-2 text-xs text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-200"
        >
          <X size={13} />
          Clear
        </button>
      )}

      {total !== undefined && (
        <span className="ml-auto text-xs tabular-nums text-zinc-600">
          {formatNumber(total)} {unit}
        </span>
      )}
    </div>
  );
}
