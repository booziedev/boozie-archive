import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Play } from 'lucide-react';

import { CoverImage } from './CoverImage';
import { SectionHeader } from './PageHeader';
import { history } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { usePlayer } from '../context/PlayerContext';
import type { PlayRecord, Track } from '../lib/types';

/** A play row, with the live library track attached where its id still resolves. */
type RecentPlay = PlayRecord & { track: Track | null };

/**
 * What you played last, newest first.
 *
 * Collapsed by track server-side, so an album left on repeat doesn't fill the
 * row with one song. Anything whose file has since been renamed or re-tagged
 * still reads correctly from the labels stored with the play — it just isn't
 * playable any more, and says so by not offering the button.
 */
export function RecentlyPlayed({ limit = 12 }: { limit?: number }) {
  const { user } = useAuth();
  const { playTracks } = usePlayer();

  const recentQuery = useQuery({
    queryKey: ['history', 'recent', limit],
    queryFn: () => history.recent(limit),
    enabled: Boolean(user),
    // Cheap, and it should feel current when you come back to the page.
    staleTime: 30_000,
  });

  const plays = (recentQuery.data?.plays ?? []) as RecentPlay[];
  const playable = plays.filter((play): play is RecentPlay & { track: Track } =>
    Boolean(play.track),
  );

  // Nothing to show until there is something to show — no empty scaffolding on
  // a fresh account's home page.
  if (!user || plays.length === 0) return null;

  return (
    <section>
      <SectionHeader
        title="Recently played"
        action={
          <Link
            to="/recap"
            className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-widest text-zinc-500 transition-colors hover:text-accent-300"
          >
            Your listening <ArrowRight size={13} />
          </Link>
        }
      />

      {/*
        A scrolling strip rather than a wrapping grid: this is a short glance
        back, and it should not push the rest of the page down on a phone.
      */}
      <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2">
        {plays.map((play) => {
          // Empty is fine: CoverImage falls back to a name-derived gradient.
          const cover = play.track?.coverId ?? play.albumId ?? '';
          const index = playable.findIndex((entry) => entry.id === play.id);

          return (
            <div key={play.id} className="w-32 shrink-0 snap-start sm:w-36">
              <div className="group relative">
                <CoverImage
                  id={cover}
                  name={play.album ?? play.title}
                  size={320}
                  rounded="rounded-xl"
                  className="aspect-square w-full shadow-card"
                />
                {play.track && (
                  <button
                    type="button"
                    onClick={() => playTracks(playable.map((entry) => entry.track), Math.max(0, index))}
                    aria-label={`Play ${play.title}`}
                    className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full bg-accent-500 text-white opacity-0 shadow-lg transition-all duration-200 group-hover:opacity-100 focus-visible:opacity-100 sm:translate-y-1 sm:group-hover:translate-y-0"
                  >
                    <Play size={16} className="ml-0.5 fill-current" />
                  </button>
                )}
              </div>

              {play.albumId ? (
                <Link to={`/albums/${play.albumId}`} className="mt-2 block">
                  <span className="block truncate text-sm font-medium text-zinc-200">
                    {play.title}
                  </span>
                  <span className="block truncate text-xs text-zinc-600">{play.artist}</span>
                </Link>
              ) : (
                <div className="mt-2">
                  <span className="block truncate text-sm font-medium text-zinc-200">
                    {play.title}
                  </span>
                  <span className="block truncate text-xs text-zinc-600">{play.artist}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
