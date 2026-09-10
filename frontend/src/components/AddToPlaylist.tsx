import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ListMusic, Loader2, Plus } from 'lucide-react';

import { playlists } from '../lib/api';
import type { Playlist } from '../lib/types';

/**
 * "Add to playlist" — a small menu of the playlists this account may write to.
 *
 * Only editable lists are offered: your own, plus a friend's collaborative
 * ones. Blends never appear, since they are generated rather than curated.
 */
export function AddToPlaylist({
  trackIds,
  label = '',
  className = 'icon-btn h-9 w-9',
}: {
  trackIds: string[];
  /** Text beside the icon. Empty renders an icon-only button. */
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey: ['playlists'],
    queryFn: () => playlists.list(),
    enabled: open,
    staleTime: 30 * 1000,
  });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const add = useMutation({
    mutationFn: (playlistId: string) => playlists.addTracks(playlistId, trackIds),
    onSuccess: (result, playlistId) => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      queryClient.invalidateQueries({ queryKey: ['playlist', playlistId] });
      // "Added" vs "already there" — worth distinguishing, since adding the
      // same album twice is a very easy mistake to make.
      setDone(result.added > 0 ? `Added ${result.added}` : 'Already there');
      window.setTimeout(() => setOpen(false), 900);
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { playlist } = await playlists.create({ name });
      await playlists.addTracks(playlist.id, trackIds);
      return playlist;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      setDone(`Added ${trackIds.length}`);
      setCreating(false);
      setName('');
      window.setTimeout(() => setOpen(false), 900);
    },
  });

  const editable: Playlist[] = (listQuery.data?.playlists ?? []).filter((entry) => entry.canEdit);
  const busy = add.isPending || create.isPending;
  const error = add.error ?? create.error;

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDone(null);
          setOpen((value) => !value);
        }}
        aria-expanded={open}
        title="Add to playlist"
        aria-label={`Add ${trackIds.length === 1 ? 'this track' : `these ${trackIds.length} tracks`} to a playlist`}
        className={className}
      >
        <ListMusic size={label ? 15 : 16} />
        {label}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1 w-60 rounded-xl border border-white/10 bg-ink-850 p-1.5 shadow-lift">
          <p className="px-2 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            {done ?? `Add ${trackIds.length === 1 ? 'track' : `${trackIds.length} tracks`} to`}
          </p>

          <div className="max-h-56 overflow-y-auto overscroll-contain">
            {listQuery.isLoading ? (
              <p className="px-2 py-3 text-center text-xs text-zinc-500">Loading…</p>
            ) : editable.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs leading-relaxed text-zinc-500">
                No playlists yet.
              </p>
            ) : (
              editable.map((playlist) => (
                <button
                  key={playlist.id}
                  type="button"
                  disabled={busy}
                  onClick={() => add.mutate(playlist.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-zinc-200 transition-colors hover:bg-white/5 disabled:opacity-60"
                >
                  <span className="min-w-0 flex-1 truncate">{playlist.name}</span>
                  {add.isPending && add.variables === playlist.id ? (
                    <Loader2 size={13} className="animate-spin text-zinc-500" />
                  ) : add.isSuccess && add.variables === playlist.id ? (
                    <Check size={13} className="text-emerald-400" />
                  ) : (
                    <span className="text-[10px] tabular-nums text-zinc-600">
                      {playlist.trackCount}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>

          {creating ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (name.trim()) create.mutate();
              }}
              className="mt-1 flex gap-1 border-t border-white/5 pt-1.5"
            >
              {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the menu opened for this */}
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Playlist name"
                maxLength={80}
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-accent-500/50 focus:outline-none"
              />
              <button type="submit" disabled={!name.trim() || busy} className="btn-primary px-2 py-1 text-xs">
                {create.isPending ? <Loader2 size={13} className="animate-spin" /> : 'Add'}
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-white/5 px-2 py-2 text-sm text-zinc-300 transition-colors hover:bg-white/5"
            >
              <Plus size={14} className="text-accent-400" />
              New playlist
            </button>
          )}

          {error && (
            <p className="px-2 pb-1 pt-1.5 text-xs text-red-400">
              {error instanceof Error ? error.message : 'Could not add that.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
