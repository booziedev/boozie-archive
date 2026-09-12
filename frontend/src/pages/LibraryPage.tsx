import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownUp, Heart, Library, Loader2, Plus } from 'lucide-react';

import { AlbumCard } from '../components/AlbumCard';
import { ArtistCard } from '../components/ArtistCard';
import { PageHeader } from '../components/PageHeader';
import { PlaylistCard } from '../components/PlaylistCard';
import { EmptyState, ErrorState } from '../components/states';
import { playlists as api } from '../lib/api';
import { useFavorites } from '../context/FavoritesContext';
import type { Album, Artist, Playlist, Saved } from '../lib/types';

/**
 * Everything you have saved or made, in one place.
 *
 * This replaces two separate destinations — Favourites and Playlists — which
 * between them were eating two of the five slots a phone's tab bar can
 * actually hold. One grid, filtered rather than split, so a library of six
 * things and a library of six hundred both read the same way.
 *
 * Liked tracks are the odd one out: a list of songs does not belong in a grid
 * of square cards. They become a single pinned card instead, which is both
 * tidier and a better front door than a fourth filter nobody would press.
 */

type Filter = 'all' | 'playlists' | 'generated' | 'albums' | 'artists';
type Sort = 'recent' | 'name';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'playlists', label: 'Playlists' },
  { key: 'generated', label: 'Made for you' },
  { key: 'albums', label: 'Albums' },
  { key: 'artists', label: 'Artists' },
];

/** One thing in the grid, with the single date the whole grid sorts on. */
type Entry =
  | { key: string; kind: 'playlist'; sortName: string; savedAt: string; playlist: Playlist }
  | { key: string; kind: 'album'; sortName: string; savedAt: string; album: Saved<Album> }
  | { key: string; kind: 'artist'; sortName: string; savedAt: string; artist: Saved<Artist> };

function isFilter(value: unknown): value is Filter {
  return FILTERS.some((entry) => entry.key === value);
}

/**
 * The pinned card for liked tracks.
 *
 * Deliberately not artwork: a gradient with a heart reads as one thing you
 * always have rather than one album among many, which is what it is.
 */
function LikedCard({ count }: { count: number }) {
  return (
    <Link to="/library/liked" className="group block">
      <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-accent-500/80 via-accent-600/40 to-ink-800 transition-transform duration-300 ease-vault group-hover:scale-[1.02]">
        <Heart size={34} className="fill-current text-white/90" strokeWidth={1.5} />
      </div>
      <p className="mt-2 truncate text-sm font-semibold text-zinc-100 transition-colors group-hover:text-white">
        Liked songs
      </p>
      <p className="truncate text-xs text-zinc-500">
        {count} {count === 1 ? 'track' : 'tracks'}
      </p>
    </Link>
  );
}

export function LibraryPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [sort, setSort] = useState<Sort>('recent');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const raw = params.get('filter');
  const filter: Filter = isFilter(raw) ? raw : 'all';
  const setFilter = (next: Filter) => {
    const updated = new URLSearchParams(params);
    if (next === 'all') updated.delete('filter');
    else updated.set('filter', next);
    setParams(updated, { replace: true });
  };

  const query = useQuery({ queryKey: ['playlists'], queryFn: () => api.list() });
  const { items, count, ready } = useFavorites();

  const create = useMutation({
    mutationFn: () => api.create({ name: name.trim() }),
    onSuccess: () => {
      setName('');
      setCreating(false);
      void queryClient.invalidateQueries({ queryKey: ['playlists'] });
    },
  });

  const all = useMemo<Entry[]>(() => {
    const lists = query.data?.playlists ?? [];
    return [
      ...lists.map((playlist): Entry => ({
        key: `p-${playlist.id}`,
        kind: 'playlist',
        sortName: playlist.name,
        // A playlist you saved sorts by when *you* saved it; one of your own,
        // by when you made it. Its owner's last edit is their business.
        savedAt: playlist.savedAt ?? playlist.createdAt,
        playlist,
      })),
      ...items.albums.map((album): Entry => ({
        key: `al-${album.id}`,
        kind: 'album',
        sortName: album.name,
        savedAt: album.savedAt,
        album,
      })),
      ...items.artists.map((artist): Entry => ({
        key: `ar-${artist.id}`,
        kind: 'artist',
        sortName: artist.name,
        savedAt: artist.savedAt,
        artist,
      })),
    ];
  }, [query.data, items]);

  const counts = useMemo(() => {
    const playlists = all.filter(
      (entry) => entry.kind === 'playlist' && entry.playlist.kind === 'manual',
    ).length;
    const generated = all.filter(
      (entry) => entry.kind === 'playlist' && entry.playlist.kind !== 'manual',
    ).length;
    return {
      all: all.length,
      playlists,
      generated,
      albums: items.albums.length,
      artists: items.artists.length,
    };
  }, [all, items]);

  const visible = useMemo(() => {
    const matches = all.filter((entry) => {
      if (filter === 'all') return true;
      // Generated lists are playlists too, so the two playlist filters have to
      // agree on `kind` — otherwise a Wrapped list shows up under both, which
      // is exactly the muddle this page exists to clear up.
      if (filter === 'playlists') return entry.kind === 'playlist' && entry.playlist.kind === 'manual';
      if (filter === 'generated') return entry.kind === 'playlist' && entry.playlist.kind !== 'manual';
      if (filter === 'albums') return entry.kind === 'album';
      return entry.kind === 'artist';
    });

    return matches.sort((a, b) =>
      sort === 'name'
        ? a.sortName.localeCompare(b.sortName)
        : b.savedAt.localeCompare(a.savedAt),
    );
  }, [all, filter, sort]);

  const loading = query.isLoading || !ready;
  const nothingAtAll = !loading && counts.all === 0 && count('track') === 0;

  if (query.isError) {
    return (
      <ErrorState error={query.error} onRetry={() => query.refetch()} title="Library unavailable" />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Library"
        subtitle="Everything you have saved or made."
        actions={
          !creating && (
            <button type="button" onClick={() => setCreating(true)} className="btn-primary">
              <Plus size={16} />
              New playlist
            </button>
          )
        }
      />

      {creating && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) create.mutate();
          }}
          className="surface flex flex-wrap gap-2 p-3"
        >
          {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the form just opened */}
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Playlist name"
            maxLength={80}
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-accent-500/50 focus:outline-none"
          />
          <button type="submit" disabled={!name.trim() || create.isPending} className="btn-primary">
            {create.isPending ? <Loader2 size={15} className="animate-spin" /> : 'Create'}
          </button>
          <button
            type="button"
            onClick={() => {
              setCreating(false);
              setName('');
            }}
            className="btn-ghost"
          >
            Cancel
          </button>
          {create.isError && (
            <p className="w-full text-xs text-red-400">
              {create.error instanceof Error ? create.error.message : 'Could not create that.'}
            </p>
          )}
        </form>
      )}

      {loading ? (
        <p className="surface p-8 text-sm text-zinc-500">Loading your library…</p>
      ) : nothingAtAll ? (
        <EmptyState
          icon={<Library size={22} />}
          title="Nothing saved yet"
          description="Heart an album or an artist as you browse, or start a playlist — whatever you keep turns up here."
        />
      ) : (
        <>
          {/* Filters scroll rather than wrap on a phone, so the row stays one
              line however many there are. */}
          <div className="flex items-center gap-3">
            <div className="no-scrollbar scroll-touch -mx-1 flex flex-1 gap-1.5 overflow-x-auto px-1 pb-0.5">
              {FILTERS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  aria-pressed={filter === key}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                    filter === key
                      ? 'bg-accent-500 text-white'
                      : 'border border-white/10 text-zinc-400 hover:border-white/20 hover:text-zinc-200'
                  }`}
                >
                  {label}
                  <span
                    className={`ml-1.5 tabular-nums ${
                      filter === key ? 'text-white/70' : 'text-zinc-600'
                    }`}
                  >
                    {counts[key]}
                  </span>
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setSort((current) => (current === 'recent' ? 'name' : 'recent'))}
              title={sort === 'recent' ? 'Sorted by recently added' : 'Sorted by name'}
              className="btn-ghost shrink-0 !px-3 !py-1.5 !text-xs"
            >
              <ArrowDownUp size={13} />
              <span className="hidden sm:inline">{sort === 'recent' ? 'Recent' : 'A–Z'}</span>
            </button>
          </div>

          <div className="card-grid">
            {/* Pinned under All, where somebody looking for their liked songs
                would go first. The other filters are about kinds of card. */}
            {filter === 'all' && <LikedCard count={count('track')} />}

            {visible.map((entry) =>
              entry.kind === 'playlist' ? (
                <PlaylistCard key={entry.key} playlist={entry.playlist} />
              ) : entry.kind === 'album' ? (
                <AlbumCard key={entry.key} album={entry.album} />
              ) : (
                <ArtistCard key={entry.key} artist={entry.artist} />
              ),
            )}
          </div>

          {visible.length === 0 && filter !== 'all' && (
            <p className="surface p-8 text-center text-sm text-zinc-500">
              Nothing here yet.
            </p>
          )}
        </>
      )}
    </div>
  );
}
