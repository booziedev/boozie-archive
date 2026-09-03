import { Users } from 'lucide-react';

import { ArtistCard } from '../components/ArtistCard';
import { FilterBar } from '../components/FilterBar';
import { PageHeader } from '../components/PageHeader';
import { CardGridSkeleton, EmptyState, ErrorState } from '../components/states';
import { useArtists } from '../hooks/useLibrary';
import { useDebounced } from '../hooks/useDebounced';
import { useListState } from '../hooks/useListState';

export function ArtistsPage() {
  const { state, update, showMore, pageSize } = useListState('name');
  const debouncedQuery = useDebounced(state.q, 250);

  const query = useArtists({
    q: debouncedQuery || undefined,
    genre: state.genre || undefined,
    sort: state.sort,
    limit: state.limit,
  });

  const artists = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  return (
    <div>
      <PageHeader title="Artists" subtitle="Everyone in the collection, by name or by volume." />

      <FilterBar
        query={state.q}
        onQueryChange={(q) => update({ q })}
        placeholder="Filter artists…"
        sort={state.sort}
        onSortChange={(sort) => update({ sort })}
        sortOptions={[
          { value: 'name', label: 'A–Z' },
          { value: 'tracks', label: 'Most tracks' },
          { value: 'recent', label: 'Recently added' },
          { value: 'duration', label: 'Longest' },
        ]}
        genre={state.genre}
        onGenreChange={(genre) => update({ genre })}
        total={total}
        unit="artists"
      />

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : query.isLoading ? (
        <CardGridSkeleton count={18} circle />
      ) : artists.length === 0 ? (
        <EmptyState
          icon={<Users size={24} />}
          title="No artists match those filters"
          description="Try a different spelling, or clear the genre filter."
        />
      ) : (
        <>
          <div className="card-grid">
            {artists.map((artist, index) => (
              <ArtistCard key={artist.id} artist={artist} eager={index < 12} />
            ))}
          </div>

          {artists.length < total && (
            <div className="mt-10 flex justify-center">
              <button type="button" onClick={showMore} className="btn-ghost">
                Show {Math.min(pageSize, total - artists.length)} more
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
