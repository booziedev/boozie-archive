import { useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Heart } from 'lucide-react';

import { AlbumCard } from '../components/AlbumCard';
import { ArtistCard } from '../components/ArtistCard';
import { PageHeader } from '../components/PageHeader';
import { TrackRow } from '../components/TrackRow';
import { CardGridSkeleton, EmptyState, TrackListSkeleton } from '../components/states';
import { api } from '../lib/api';
import { useFavorites } from '../context/FavoritesContext';
import type { Album, Artist, Track } from '../lib/types';

type Tab = 'track' | 'album' | 'artist';

const TABS: { key: Tab; label: string }[] = [
  { key: 'track', label: 'Tracks' },
  { key: 'album', label: 'Albums' },
  { key: 'artist', label: 'Artists' },
];

/**
 * Favourites live in localStorage as bare ids, so this page resolves each id
 * against the API. Ids that no longer exist (files removed from the library)
 * simply drop out of the list instead of erroring the page.
 */
export function FavouritesPage() {
  const { favorites, clear } = useFavorites();
  const [tab, setTab] = useState<Tab>('track');

  const trackQueries = useQueries({
    queries: favorites.track.map((id) => ({
      queryKey: ['track', id],
      queryFn: () => api.track(id),
      staleTime: 5 * 60 * 1000,
      retry: false,
    })),
  });

  const albumQueries = useQueries({
    queries: favorites.album.map((id) => ({
      queryKey: ['album', id],
      queryFn: () => api.album(id),
      staleTime: 5 * 60 * 1000,
      retry: false,
    })),
  });

  const artistQueries = useQueries({
    queries: favorites.artist.map((id) => ({
      queryKey: ['artist', id],
      queryFn: () => api.artist(id),
      staleTime: 5 * 60 * 1000,
      retry: false,
    })),
  });

  const tracks = trackQueries
    .map((query) => query.data?.track)
    .filter((value): value is Track => Boolean(value));
  const albums = albumQueries
    .map((query) => query.data?.album)
    .filter((value): value is Album => Boolean(value));
  const artists = artistQueries
    .map((query) => query.data?.artist)
    .filter((value): value is Artist => Boolean(value));

  const loading =
    (tab === 'track' && trackQueries.some((query) => query.isLoading)) ||
    (tab === 'album' && albumQueries.some((query) => query.isLoading)) ||
    (tab === 'artist' && artistQueries.some((query) => query.isLoading));

  const total = favorites.track.length + favorites.album.length + favorites.artist.length;
  const counts: Record<Tab, number> = {
    track: favorites.track.length,
    album: favorites.album.length,
    artist: favorites.artist.length,
  };

  return (
    <div>
      <PageHeader
        title="Favourites"
        subtitle="Saved on this device — nothing leaves your browser."
        actions={
          total > 0 ? (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Remove every favourite from this device?')) clear();
              }}
              className="btn-ghost"
            >
              Clear all
            </button>
          ) : null
        }
      />

      <div className="mb-6 flex gap-1.5 rounded-xl border border-white/5 bg-white/[0.02] p-1">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-widest transition-colors ${
              tab === key ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {label}
            <span className="ml-1.5 tabular-nums text-zinc-600">{counts[key]}</span>
          </button>
        ))}
      </div>

      {counts[tab] === 0 ? (
        <EmptyState
          icon={<Heart size={24} />}
          title={`No favourite ${tab}s yet`}
          description="Tap the heart on any card or track row to keep it here."
        />
      ) : loading ? (
        tab === 'track' ? (
          <TrackListSkeleton count={Math.min(counts[tab], 8)} />
        ) : (
          <CardGridSkeleton count={Math.min(counts[tab], 12)} circle={tab === 'artist'} />
        )
      ) : tab === 'track' ? (
        <div className="surface divide-y divide-white/[0.03] p-1.5">
          {tracks.map((track, index) => (
            <TrackRow key={track.id} track={track} tracks={tracks} index={index} variant="flat" />
          ))}
        </div>
      ) : tab === 'album' ? (
        <div className="card-grid">
          {albums.map((album) => (
            <AlbumCard key={album.id} album={album} />
          ))}
        </div>
      ) : (
        <div className="card-grid">
          {artists.map((artist) => (
            <ArtistCard key={artist.id} artist={artist} />
          ))}
        </div>
      )}
    </div>
  );
}
