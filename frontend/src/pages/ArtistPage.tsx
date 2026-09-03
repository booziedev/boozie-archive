import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Disc3, ListPlus, Play, Shuffle } from 'lucide-react';

import { AlbumCard } from '../components/AlbumCard';
import { CoverImage } from '../components/CoverImage';
import { FavoriteButton } from '../components/FavoriteButton';
import { SectionHeader } from '../components/PageHeader';
import { TrackRow } from '../components/TrackRow';
import { CardGridSkeleton, EmptyState, ErrorState, TrackListSkeleton } from '../components/states';
import { useArtist, useTracks } from '../hooks/useLibrary';
import { usePlayer } from '../context/PlayerContext';
import { formatNumber, formatRuntime } from '../lib/format';

/** Artist detail: header, album grid and the artist's full track list. */
export function ArtistPage() {
  const { id } = useParams<{ id: string }>();
  const [showAllTracks, setShowAllTracks] = useState(false);
  const artistQuery = useArtist(id);
  const { playTracks, enqueue, toggleShuffle, shuffle } = usePlayer();

  // The full track list is only fetched when it is actually shown.
  const tracksQuery = useTracks({ artistId: id, limit: 1000 }, Boolean(id) && showAllTracks);

  if (artistQuery.isError) {
    return (
      <ErrorState error={artistQuery.error} onRetry={() => artistQuery.refetch()} title="Artist unavailable" />
    );
  }

  if (artistQuery.isLoading || !artistQuery.data) {
    return (
      <div className="space-y-8">
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-end">
          <div className="skeleton aspect-square w-40 rounded-full" />
          <div className="flex-1 space-y-3">
            <div className="skeleton h-9 w-1/2 rounded" />
            <div className="skeleton h-4 w-1/3 rounded" />
          </div>
        </div>
        <CardGridSkeleton count={6} />
      </div>
    );
  }

  const { artist, albums } = artistQuery.data;
  const tracks = tracksQuery.data?.items ?? [];

  /** Plays the artist top-to-bottom; fetches the track list if needed. */
  async function playEverything(startShuffled: boolean) {
    if (tracks.length > 0) {
      if (startShuffled && !shuffle) toggleShuffle();
      playTracks(tracks, startShuffled ? Math.floor(Math.random() * tracks.length) : 0);
      return;
    }
    setShowAllTracks(true);
    const result = await tracksQuery.refetch();
    const fetched = result.data?.items ?? [];
    if (fetched.length === 0) return;
    if (startShuffled && !shuffle) toggleShuffle();
    playTracks(fetched, startShuffled ? Math.floor(Math.random() * fetched.length) : 0);
  }

  return (
    <div className="space-y-10">
      <header className="flex flex-col items-center gap-6 text-center sm:flex-row sm:items-end sm:text-left animate-fade-up">
        <CoverImage
          id={artist.id}
          name={artist.name}
          hasCover={artist.hasCover}
          size={640}
          eager
          rounded="rounded-full"
          className="aspect-square w-40 shadow-lift ring-1 ring-white/10 sm:w-48"
        />

        <div className="min-w-0 flex-1 space-y-3">
          <span className="pill pill-accent">Artist</span>
          <h1 className="text-balance text-3xl font-extrabold tracking-tight text-white sm:text-5xl">
            {artist.name}
          </h1>
          <p className="text-sm text-zinc-400">
            {formatNumber(artist.albumCount)} {artist.albumCount === 1 ? 'album' : 'albums'} ·{' '}
            {formatNumber(artist.trackCount)} tracks · {formatRuntime(artist.duration)}
          </p>
          {artist.genres.length > 0 && (
            <p className="text-xs text-zinc-600">{artist.genres.join(' · ')}</p>
          )}

          <div className="flex flex-wrap items-center justify-center gap-2 pt-1 sm:justify-start">
            <button type="button" onClick={() => void playEverything(false)} className="btn-primary">
              <Play size={16} className="fill-current" />
              Play all
            </button>
            <button type="button" onClick={() => void playEverything(true)} className="btn-ghost">
              <Shuffle size={15} />
              Shuffle
            </button>
            {tracks.length > 0 && (
              <button type="button" onClick={() => enqueue(tracks, 'end')} className="btn-ghost">
                <ListPlus size={15} />
                Queue all
              </button>
            )}
            <FavoriteButton kind="artist" id={artist.id} label={artist.name} />
          </div>
        </div>
      </header>

      <section>
        <SectionHeader title={`Albums (${albums.length})`} />
        {albums.length === 0 ? (
          <EmptyState icon={<Disc3 size={24} />} title="No albums indexed for this artist" />
        ) : (
          <div className="card-grid">
            {albums.map((album, index) => (
              <AlbumCard key={album.id} album={album} showArtist={false} eager={index < 6} />
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHeader
          title="All tracks"
          action={
            !showAllTracks ? (
              <button
                type="button"
                onClick={() => setShowAllTracks(true)}
                className="text-xs font-semibold uppercase tracking-widest text-zinc-500 transition-colors hover:text-accent-300"
              >
                Show {formatNumber(artist.trackCount)}
              </button>
            ) : null
          }
        />

        {!showAllTracks ? (
          <p className="text-sm text-zinc-600">
            Track-level metadata is loaded on demand to keep large artists snappy.
          </p>
        ) : tracksQuery.isError ? (
          <ErrorState error={tracksQuery.error} onRetry={() => tracksQuery.refetch()} />
        ) : tracksQuery.isLoading ? (
          <TrackListSkeleton />
        ) : (
          <div className="surface divide-y divide-white/[0.03] p-1.5">
            {tracks.map((track, index) => (
              <TrackRow key={track.id} track={track} tracks={tracks} index={index} variant="flat" />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
