import { useSearchParams } from 'react-router-dom';
import { SearchX } from 'lucide-react';

import { AlbumCard } from '../components/AlbumCard';
import { ArtistCard } from '../components/ArtistCard';
import { PageHeader, SectionHeader } from '../components/PageHeader';
import { TrackRow } from '../components/TrackRow';
import { CardGridSkeleton, EmptyState, ErrorState, TrackListSkeleton } from '../components/states';
import { useAlbums, useArtists, useTracks } from '../hooks/useLibrary';

/** Full results page behind the header search bar (`/search?q=…`). */
export function SearchPage() {
  const [params] = useSearchParams();
  const q = (params.get('q') ?? '').trim();
  const enabled = q.length > 0;

  const artists = useArtists({ q, limit: 12 });
  const albums = useAlbums({ q, limit: 18 });
  const tracks = useTracks({ q, limit: 50 }, enabled);

  if (!enabled) {
    return (
      <EmptyState
        icon={<SearchX size={24} />}
        title="Type something to search"
        description="Search covers artist names, album titles and track titles."
      />
    );
  }

  const isLoading = artists.isLoading || albums.isLoading || tracks.isLoading;
  const error = artists.error ?? albums.error ?? tracks.error;
  const totalHits =
    (artists.data?.total ?? 0) + (albums.data?.total ?? 0) + (tracks.data?.total ?? 0);

  return (
    <div className="space-y-10">
      <PageHeader
        title={`Results for “${q}”`}
        subtitle={isLoading ? 'Searching…' : `${totalHits} matches across the collection`}
      />

      {error ? (
        <ErrorState
          error={error}
          onRetry={() => {
            void artists.refetch();
            void albums.refetch();
            void tracks.refetch();
          }}
        />
      ) : totalHits === 0 && !isLoading ? (
        <EmptyState
          title={`Nothing matches “${q}”`}
          description="Tags come straight from the files — try a shorter query or a different spelling."
        />
      ) : (
        <>
          {(artists.isLoading || (artists.data?.items.length ?? 0) > 0) && (
            <section>
              <SectionHeader title={`Artists (${artists.data?.total ?? 0})`} />
              {artists.isLoading ? (
                <CardGridSkeleton count={6} circle />
              ) : (
                <div className="card-grid">
                  {artists.data?.items.map((artist) => <ArtistCard key={artist.id} artist={artist} />)}
                </div>
              )}
            </section>
          )}

          {(albums.isLoading || (albums.data?.items.length ?? 0) > 0) && (
            <section>
              <SectionHeader title={`Albums (${albums.data?.total ?? 0})`} />
              {albums.isLoading ? (
                <CardGridSkeleton count={6} />
              ) : (
                <div className="card-grid">
                  {albums.data?.items.map((album) => <AlbumCard key={album.id} album={album} />)}
                </div>
              )}
            </section>
          )}

          {(tracks.isLoading || (tracks.data?.items.length ?? 0) > 0) && (
            <section>
              <SectionHeader title={`Tracks (${tracks.data?.total ?? 0})`} />
              {tracks.isLoading ? (
                <TrackListSkeleton />
              ) : (
                <div className="surface divide-y divide-white/[0.03] p-1.5">
                  {(tracks.data?.items ?? []).map((track, index) => (
                    <TrackRow
                      key={track.id}
                      track={track}
                      tracks={tracks.data!.items}
                      index={index}
                      variant="flat"
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
