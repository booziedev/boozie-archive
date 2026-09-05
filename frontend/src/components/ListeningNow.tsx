import { Link } from 'react-router-dom';
import { Pause } from 'lucide-react';

import type { NowPlaying } from '../lib/types';

/**
 * Three bars that rise and fall while a track is running.
 *
 * Drawn with CSS rather than an icon so it animates, and swapped for a pause
 * glyph when the track is held — which is the difference between "they're
 * listening" and "they left it open".
 */
function PlayingIndicator({ playing }: { playing: boolean }) {
  if (!playing) {
    return <Pause size={11} className="shrink-0 fill-current text-zinc-500" aria-hidden />;
  }

  return (
    <span className="flex h-3 shrink-0 items-end gap-[2px]" aria-hidden>
      {[0, 1, 2].map((bar) => (
        <span
          key={bar}
          className="eq-bar w-[2px] rounded-full bg-accent-400"
          style={{ animationDelay: `${bar * 0.16}s` }}
        />
      ))}
    </span>
  );
}

/**
 * "Listening to X by Y", or the paused version of it.
 *
 * The whole line links to the album when there is one, so a friend's status
 * doubles as a way into what they are playing.
 */
export function ListeningNow({
  now,
  className = '',
  compact = false,
}: {
  now: NowPlaying | null | undefined;
  className?: string;
  /** Drops the leading label, for tight rows like the thread list. */
  compact?: boolean;
}) {
  if (!now) return null;

  const label = `${now.title} — ${now.artist}`;
  const body = (
    <>
      <PlayingIndicator playing={now.isPlaying} />
      <span className="min-w-0 truncate">
        {!compact && (
          <span className="text-zinc-500">{now.isPlaying ? 'Listening to ' : 'Paused — '}</span>
        )}
        <span className="font-medium text-zinc-300">{now.title}</span>
        <span className="text-zinc-500"> · {now.artist}</span>
      </span>
    </>
  );

  const classes = `flex min-w-0 items-center gap-1.5 text-xs ${className}`;

  return now.albumId ? (
    <Link
      to={`/albums/${now.albumId}`}
      title={label}
      className={`${classes} transition-colors hover:text-accent-300`}
    >
      {body}
    </Link>
  ) : (
    <span title={label} className={classes}>
      {body}
    </span>
  );
}
