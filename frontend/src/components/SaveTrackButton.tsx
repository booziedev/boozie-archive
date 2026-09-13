import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Heart, Loader2, Plus } from 'lucide-react';

import { Portal } from './Portal';
import { playlists } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useFavorites } from '../context/FavoritesContext';
import type { Playlist } from '../lib/types';

/**
 * "Save this track" — one heart that covers Liked Songs and every playlist.
 *
 * These used to be two buttons sitting next to each other, a heart and a list
 * icon, which is one button too many on a row that already carries five. They
 * are the same decision anyway: where do I keep this. So the heart opens a
 * menu with Liked Songs at the top and the playlists you can write to below
 * it, and still shows its filled state so a glance tells you what is liked
 * without opening anything.
 *
 * Only editable lists are offered: your own, plus a friend's collaborative
 * ones. Generated lists never appear, since they are rebuilt from the play log
 * rather than curated.
 */

/** Where to draw the menu, in viewport coordinates. */
interface Anchor {
  top: number;
  right: number;
  /** True when there is more room above the trigger than below it. */
  above: boolean;
}

const MENU_WIDTH = 240;
const MENU_MAX_HEIGHT = 320;

export function SaveTrackButton({
  trackId,
  title,
  className = 'icon-btn h-9 w-9',
  size = 16,
}: {
  trackId: string;
  title: string;
  className?: string;
  size?: number;
}) {
  const { user } = useAuth();
  const { isFavorite, toggle } = useFavorites();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const liked = user ? isFavorite('track', trackId) : false;

  const listQuery = useQuery({
    queryKey: ['playlists'],
    queryFn: () => playlists.list(),
    enabled: open,
    staleTime: 30 * 1000,
  });

  /**
   * The menu is portalled, so it has to be told where to go.
   *
   * Anchoring in viewport coordinates rather than positioning it against the
   * button is what lets it escape its row: track lists live inside
   * `surface overflow-hidden` on more than one page, which clips an absolutely
   * positioned menu at the edge of the list. Flipping above the trigger when
   * the space below is short keeps the last row in a long list usable.
   */
  useLayoutEffect(() => {
    if (!open) return;

    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom;
      const above = below < Math.min(MENU_MAX_HEIGHT, 260) && rect.top > below;
      setAnchor({
        top: above ? rect.top - 6 : rect.bottom + 6,
        // Right-aligned to the trigger, but never off the left edge on a phone.
        right: Math.max(8, window.innerWidth - rect.right),
        above,
      });
    };

    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      // The menu is not inside the button any more, so both have to be checked.
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) {
        setOpen(false);
      }
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
    mutationFn: (playlistId: string) => playlists.addTracks(playlistId, [trackId]),
    onSuccess: (result, playlistId) => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      queryClient.invalidateQueries({ queryKey: ['playlist', playlistId] });
      // "Added" vs "already there" — worth distinguishing, since adding the
      // same track twice is a very easy mistake to make.
      setDone(result.added > 0 ? 'Added' : 'Already there');
      window.setTimeout(() => setOpen(false), 900);
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { playlist } = await playlists.create({ name });
      await playlists.addTracks(playlist.id, [trackId]);
      return playlist;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      setDone('Added');
      setCreating(false);
      setName('');
      window.setTimeout(() => setOpen(false), 900);
    },
  });

  // Favourites live on the account, so there is nowhere to put one while
  // signed out — and a heart that silently does nothing is worse than none.
  if (!user) return null;

  const editable: Playlist[] = (listQuery.data?.playlists ?? []).filter((entry) => entry.canEdit);
  const busy = add.isPending || create.isPending;
  const error = add.error ?? create.error;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDone(null);
          setCreating(false);
          setOpen((value) => !value);
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        title={liked ? 'Saved — change where' : 'Save to Liked Songs or a playlist'}
        aria-label={`Save ${title} to Liked Songs or a playlist`}
        className={`icon-btn ${liked ? 'text-rose-400 hover:text-rose-300' : ''} ${className}`}
      >
        <Heart
          size={size}
          strokeWidth={2.2}
          className={`transition-transform duration-300 ease-vault ${liked ? 'scale-110 fill-current' : ''}`}
        />
      </button>

      {open && anchor && (
        <Portal>
          <div
            ref={menuRef}
            role="menu"
            className="fixed z-[60] w-60 rounded-xl border border-white/10 bg-ink-850 p-1.5 shadow-lift animate-scale-in"
            style={{
              top: anchor.above ? undefined : anchor.top,
              bottom: anchor.above ? window.innerHeight - anchor.top : undefined,
              right: anchor.right,
              maxWidth: `calc(100vw - ${anchor.right + 8}px)`,
              width: MENU_WIDTH,
            }}
          >
            <p className="px-2 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              {done ?? 'Save to'}
            </p>

            {/* Liked Songs first: it is the one everybody reaches for, and it
                is the only entry that toggles rather than adds. */}
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={liked}
              onClick={() => {
                toggle('track', trackId);
                setDone(liked ? 'Removed' : 'Liked');
                window.setTimeout(() => setOpen(false), 700);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-zinc-200 transition-colors hover:bg-white/5"
            >
              <Heart
                size={14}
                className={liked ? 'fill-current text-rose-400' : 'text-zinc-500'}
                strokeWidth={2.2}
              />
              <span className="min-w-0 flex-1 truncate">Liked songs</span>
              {liked && <Check size={13} className="text-rose-400" />}
            </button>

            <div className="my-1 border-t border-white/5" />

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
                    role="menuitem"
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
        </Portal>
      )}
    </>
  );
}
