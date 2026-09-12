import { Link } from 'react-router-dom';
import { Lock, Users } from 'lucide-react';

import { CoverImage } from './CoverImage';
import { formatRuntime } from '../lib/format';
import type { Playlist } from '../lib/types';

/**
 * One playlist card.
 *
 * Lives here rather than beside a page because three different places render
 * it — the Library, a profile, and anywhere a list of playlists appears.
 */
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
