import { Music2, Play, Shuffle } from 'lucide-react';

import { FilterBar } from '../components/FilterBar';
import { PageHeader } from '../components/PageHeader';
import { TrackRow } from '../components/TrackRow';
import { EmptyState, ErrorState, TrackListSkeleton } from '../components/states';
import { useTracks } from '../hooks/useLibrary';
import { useDebounced } from '../hooks/useDebounced';
import { useListState } from '../hooks/useListState';
import { usePlayer } from '../context/PlayerContext';

/** Flat, searchable view over every track in the library. */
export function TracksPage() {
  const { state, update, showMore, pageSize } = useListState('name', 100);
  const debouncedQuery = useDebounced(state.q, 250);
  const { playTracks, toggleShuffle, shuffle } = usePlayer();

  const query = useTracks({
    q: debouncedQuery || undefined,
    genre: state.genre || undefined,
    year: state.year === '' ? undefined : state.year,
    sort: state.sort,
    limit: state.limit,
  });

  const tracks = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  return (
    <div>
      <PageHeader
        title="Tracks"
        subtitle="Search the whole collection by title, artist or album."
        actions={
          tracks.length > 0 ? (
            <div className="flex gap-2">
              <button type="button" onClick={() => playTracks(tracks, 0)} className="btn-primary">
                <Play size={15} className="fill-current" />
                Play these
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!shuffle) toggleShuffle();
                  playTracks(tracks, Math.floor(Math.random() * tracks.length));
                }}
                className="btn-ghost"
                title="Shuffle these results"
              >
                <Shuffle size={15} />
              </button>
            </div>
          ) : null
        }
      />

      <FilterBar
        query={state.q}
        onQueryChange={(q) => update({ q })}
        placeholder="Search tracks…"
        sort={state.sort}
        onSortChange={(sort) => update({ sort })}
        sortOptions={[
          { value: 'name', label: 'A–Z' },
          { value: 'recent', label: 'Recently added' },
          { value: 'year', label: 'Newest first' },
          { value: 'duration', label: 'Longest' },
          { value: 'random', label: 'Surprise me' },
        ]}
        genre={state.genre}
        onGenreChange={(genre) => update({ genre })}
        year={state.year}
        onYearChange={(year) => update({ year })}
        total={total}
        unit="tracks"
      />

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : query.isLoading ? (
        <TrackListSkeleton count={14} />
      ) : tracks.length === 0 ? (
        <EmptyState
          icon={<Music2 size={24} />}
          title="No tracks match that search"
          description="Metadata comes straight from your files — try the album name or a different spelling."
        />
      ) : (
        <>
          <div className="surface divide-y divide-white/[0.03] p-1.5">
            {tracks.map((track, index) => (
              <TrackRow key={track.id} track={track} tracks={tracks} index={index} variant="flat" />
            ))}
          </div>

          {tracks.length < total && (
            <div className="mt-8 flex justify-center">
              <button type="button" onClick={showMore} className="btn-ghost">
                Show {Math.min(pageSize, total - tracks.length)} more
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
