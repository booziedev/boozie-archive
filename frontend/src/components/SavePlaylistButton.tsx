import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BookmarkCheck, BookmarkPlus, Loader2 } from 'lucide-react';

import { playlists } from '../lib/api';
import type { Playlist } from '../lib/types';

/**
 * Keeps somebody else's playlist in your library, or takes it back out.
 *
 * Being able to open a playlist and wanting it in your library are different
 * things: a public playlist is reachable by anyone, and this is how one stops
 * being something you can find and starts being something you keep.
 *
 * Filled and in the accent colour once saved, outlined and grey when not —
 * the same read as the favourite heart elsewhere.
 */
export function SavePlaylistButton({
  playlist,
  className = 'icon-btn h-9 w-9',
}: {
  playlist: Playlist;
  className?: string;
}) {
  const queryClient = useQueryClient();

  const toggle = useMutation({
    mutationFn: () => (playlist.saved ? playlists.unsave(playlist.id) : playlists.save(playlist.id)),
    onSuccess: ({ playlist: next }) => {
      // Patch the copy this page is reading so the icon flips at once, then
      // let the lists catch up in their own time.
      queryClient.setQueryData(['playlist', playlist.id], (old: unknown) =>
        old && typeof old === 'object' ? { ...(old as object), playlist: next } : old,
      );
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
    },
  });

  // Your own playlists are in your library by definition; there is nothing to
  // add and nothing to remove.
  if (playlist.isOwner) return null;

  const saved = playlist.saved;

  return (
    <button
      type="button"
      onClick={() => toggle.mutate()}
      disabled={toggle.isPending}
      aria-pressed={saved}
      aria-label={saved ? 'Remove from your library' : 'Add to your library'}
      title={saved ? 'In your library — click to remove' : 'Add to your library'}
      className={`${className} transition-colors ${saved ? 'text-accent-400 hover:text-accent-300' : ''}`}
    >
      {toggle.isPending ? (
        <Loader2 size={16} className="animate-spin" />
      ) : saved ? (
        <BookmarkCheck size={16} className="fill-current" />
      ) : (
        <BookmarkPlus size={16} />
      )}
    </button>
  );
}
