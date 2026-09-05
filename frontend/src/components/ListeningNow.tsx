import { Link } from 'react-router-dom';

import type { NowPlaying } from '../lib/types';

/**
 * Three bars that rise and fall while a track is running.
 *
 * A status only exists while something is actually playing — the server never
 * returns a paused one — so there is no held state to draw.
 */
function PlayingIndicator() {
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
 * "Listening to X by Y".
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
      <PlayingIndicator />
      <span className="min-w-0 truncate">
        {!compact && <span className="text-zinc-500">Listening to </span>}
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
