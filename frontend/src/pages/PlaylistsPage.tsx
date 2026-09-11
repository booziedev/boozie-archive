import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListMusic, Loader2, Lock, Plus, Users } from 'lucide-react';

import { CoverImage } from '../components/CoverImage';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/states';
import { playlists as api } from '../lib/api';
import { formatRuntime } from '../lib/format';
import type { Playlist } from '../lib/types';

/** One card in the grid. Also used by the profile page's playlists section. */
export function PlaylistCard({ playlist }: { playlist: Playlist }) {
  return (
    <Link to={`/playlists/${playlist.id}`} className="group block">
      <div className="relative">
        {playlist.coverUrl ? (
          <img
            src={playlist.coverUrl}
            alt=""
            loading="lazy"
            className="aspect-square w-full rounded-xl bg-ink-800 object-cover"
          />
        ) : (
          <CoverImage
            id={playlist.coverId ?? ''}
            name={playlist.name}
            size={320}
            rounded="rounded-xl"
            className="aspect-square w-full"
          />
        )}
        {/* Both badges can apply at once — a private list shared with two
            people — so they sit in a row rather than on top of each other. */}
        <span className="absolute right-2 top-2 flex items-center gap-1">
          {playlist.visibility === 'private' && (
            <span
              title="Only you and anyone you invite"
              className="rounded-full bg-black/70 p-1.5 text-zinc-300 backdrop-blur"
            >
              <Lock size={12} />
            </span>
          )}
          {playlist.memberCount > 0 && (
            <span
              title={`Shared with ${playlist.memberCount} ${playlist.memberCount === 1 ? 'person' : 'people'}`}
              className="flex items-center gap-1 rounded-full bg-black/70 px-2 py-1 text-[10px] font-semibold text-accent-300 backdrop-blur"
            >
              <Users size={11} />
              {playlist.memberCount}
            </span>
          )}
        </span>
      </div>
      <p className="mt-2 truncate text-sm font-semibold text-zinc-100 transition-colors group-hover:text-white">
        {playlist.name}
      </p>
      <p className="truncate text-xs text-zinc-500">
        {playlist.trackCount} {playlist.trackCount === 1 ? 'track' : 'tracks'}
        {playlist.trackCount > 0 && ` · ${formatRuntime(playlist.duration)}`}
      </p>
    </Link>
  );
}

/**
 * Every playlist this account can open: their own, and whatever friends have
 * shared. Grouped so a page full of other people's lists never buries yours.
 */
export function PlaylistsPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const query = useQuery({ queryKey: ['playlists'], queryFn: () => api.list() });

  const create = useMutation({
    mutationFn: () => api.create({ name: name.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      setName('');
      setCreating(false);
    },
  });

  const all = query.data?.playlists ?? [];
  const mine = all.filter((playlist) => playlist.isOwner);
  // Kept, rather than merely reachable — nothing lands here without being saved.
  const saved = all.filter((playlist) => !playlist.isOwner);

  return (
    <div>
      <PageHeader
        title="Playlists"
        subtitle="Yours, plus the ones you have saved."
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
          className="surface mb-6 flex flex-wrap gap-2 p-3"
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

      {query.isLoading ? (
        <div className="card-grid">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="aspect-square animate-pulse rounded-xl bg-white/[0.04]" />
          ))}
        </div>
      ) : all.length === 0 ? (
        <EmptyState
          icon={<ListMusic size={24} />}
          title="No playlists yet"
          description="Make one here, or add a track to a new playlist from any track row."
        />
      ) : (
        <div className="space-y-8">
          {mine.length > 0 && (
            <div className="card-grid">
              {mine.map((playlist) => (
                <PlaylistCard key={playlist.id} playlist={playlist} />
              ))}
            </div>
          )}

          {saved.length > 0 && (
            <div>
              <h2 className="mb-4 text-base font-bold uppercase tracking-[0.14em] text-zinc-300">
                Saved
              </h2>
              <div className="card-grid">
                {saved.map((playlist) => (
                  <div key={playlist.id}>
                    <PlaylistCard playlist={playlist} />
                    <p className="truncate text-[11px] text-zinc-600">
                      by {playlist.ownerDisplayName || playlist.ownerUsername}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
