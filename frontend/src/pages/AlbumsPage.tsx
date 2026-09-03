import { Disc3 } from 'lucide-react';

import { AlbumCard } from '../components/AlbumCard';
import { FilterBar } from '../components/FilterBar';
import { PageHeader } from '../components/PageHeader';
import { CardGridSkeleton, EmptyState, ErrorState } from '../components/states';
import { useAlbums } from '../hooks/useLibrary';
import { useDebounced } from '../hooks/useDebounced';
import { useListState } from '../hooks/useListState';

export function AlbumsPage() {
  const { state, update, showMore, pageSize } = useListState('name');
  const debouncedQuery = useDebounced(state.q, 250);

  const query = useAlbums({
    q: debouncedQuery || undefined,
    genre: state.genre || undefined,
    year: state.year === '' ? undefined : state.year,
    sort: state.sort,
    limit: state.limit,
  });

  const albums = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  return (
    <div>
      <PageHeader title="Albums" subtitle="Every release in the vault, cover-first." />

      <FilterBar
        query={state.q}
        onQueryChange={(q) => update({ q })}
        placeholder="Filter albums…"
        sort={state.sort}
        onSortChange={(sort) => update({ sort })}
        sortOptions={[
          { value: 'name', label: 'A–Z' },
          { value: 'recent', label: 'Recently added' },
          { value: 'year', label: 'Newest first' },
          { value: 'tracks', label: 'Most tracks' },
          { value: 'random', label: 'Surprise me' },
        ]}
        genre={state.genre}
        onGenreChange={(genre) => update({ genre })}
        year={state.year}
        onYearChange={(year) => update({ year })}
        total={total}
        unit="albums"
      />

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : query.isLoading ? (
        <CardGridSkeleton count={18} />
      ) : albums.length === 0 ? (
        <EmptyState
          icon={<Disc3 size={24} />}
          title="No albums match those filters"
          description="Clear a filter or search for something else."
        />
      ) : (
        <>
          <div className="card-grid">
            {albums.map((album, index) => (
              <AlbumCard key={album.id} album={album} eager={index < 12} />
            ))}
          </div>

          {albums.length < total && (
            <div className="mt-10 flex justify-center">
              <button type="button" onClick={showMore} className="btn-ghost">
                Show {Math.min(pageSize, total - albums.length)} more
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
