import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Clock, Disc3, ListMusic, Lock, Music2, Radio, Users } from 'lucide-react';

import { CoverImage } from '../components/CoverImage';
import { PageHeader, SectionHeader } from '../components/PageHeader';
import { EmptyState, ErrorState } from '../components/states';
import { history, playlists, scrobbles } from '../lib/api';
import { formatRuntime } from '../lib/format';
import type { ExternalTop, HistoryRange, TopEntry } from '../lib/types';

const RANGES: { value: HistoryRange; label: string }[] = [
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'year', label: 'This year' },
  { value: 'all', label: 'All time' },
];

/** "3 h 24 m", or "12 m" for anything under an hour. */
function listeningTime(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} m`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} m`;
}

/** "just after 9pm" — friendlier than a bare 21. */
function hourLabel(hour: number): string {
  const suffix = hour < 12 ? 'am' : 'pm';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}${suffix}`;
}

/**
 * The generated playlists, built from this account's own listening.
 *
 * They are made on first visit and then kept, so this both fetches and creates
 * them. Anything with nothing in it yet is left out by the server rather than
 * shown as an empty card.
 */
function WrappedPlaylists() {
  const query = useQuery({
    queryKey: ['playlists', 'wrapped'],
    queryFn: playlists.wrapped,
    staleTime: 5 * 60 * 1000,
  });

  const wrapped = query.data?.wrapped ?? [];
  if (query.isLoading || wrapped.length === 0) return null;

  return (
    <section>
      <SectionHeader
        title="Made for you"
        action={<span className="text-xs text-zinc-600">Private until you share them</span>}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        {wrapped.map(({ playlist, entries }) => (
          <Link
            key={playlist.id}
            to={`/playlists/${playlist.id}`}
            className="surface surface-hover group flex gap-3 p-3"
          >
            {/* The first four covers, as a little mosaic. */}
            <span className="grid h-16 w-16 shrink-0 grid-cols-2 grid-rows-2 overflow-hidden rounded-lg">
              {entries.slice(0, 4).map((entry) => (
                <CoverImage
                  key={entry.trackId}
                  id={entry.albumId ?? ''}
                  name={entry.album ?? entry.title}
                  size={128}
                  rounded=""
                  className="h-8 w-8"
                />
              ))}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <ListMusic size={12} className="shrink-0 text-accent-400" />
                <span className="truncate text-sm font-semibold text-zinc-100">{playlist.name}</span>
              </span>
              <span className="mt-0.5 block truncate text-xs text-zinc-500">
                {playlist.trackCount} tracks · {formatRuntime(playlist.duration)}
              </span>
              {playlist.visibility === 'private' && (
                <span className="mt-1.5 flex items-center gap-1 text-[10px] text-zinc-600">
                  <Lock size={9} />
                  Only you
                </span>
              )}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="surface p-4">
      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">
        {icon}
        {label}
      </span>
      <p className="mt-1.5 text-2xl font-extrabold tabular-nums text-white">{value}</p>
    </div>
  );
}

/** A numbered chart — tracks, artists or albums. */
function Chart({
  title,
  entries,
  showCover,
}: {
  title: string;
  entries: TopEntry[];
  showCover: boolean;
}) {
  if (entries.length === 0) return null;

  return (
    <section>
      <SectionHeader title={title} />
      <ol className="surface divide-y divide-white/[0.03] p-1.5">
        {entries.map((entry, index) => {
          const row = (
            <>
              <span className="w-6 shrink-0 text-center text-sm font-bold tabular-nums text-zinc-600">
                {index + 1}
              </span>
              {showCover && entry.albumId && (
                <CoverImage
                  id={entry.albumId}
                  name={entry.name}
                  size={128}
                  rounded="rounded-lg"
                  className="h-10 w-10 shrink-0"
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-zinc-100">{entry.name}</span>
                {entry.subtitle && (
                  <span className="block truncate text-xs text-zinc-600">{entry.subtitle}</span>
                )}
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-sm font-semibold tabular-nums text-zinc-300">
                  {entry.plays}
                </span>
                <span className="block text-[10px] uppercase tracking-wider text-zinc-600">
                  {entry.plays === 1 ? 'play' : 'plays'}
                </span>
              </span>
            </>
          );

          return (
            <li key={`${entry.key}-${index}`}>
              {entry.albumId ? (
                <Link
                  to={`/albums/${entry.albumId}`}
                  className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/[0.03]"
                >
                  {row}
                </Link>
              ) : (
                <div className="flex items-center gap-3 px-2 py-2">{row}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * The listening recap — *Spotify Wrapped / Apple Replay*, without waiting for
 * December.
 *
 * Every window is available all year, because "what have I been playing this
 * month" is the question people actually have. It reads entirely from the play
 * log, so it is empty until there is something to summarise.
 */
/**
 * What a connected Last.fm account has been playing.
 *
 * Kept visually apart from everything above it, and never folded into those
 * numbers: the archive's stats are about music this archive holds, and mixing
 * in plays from somewhere else would make both halves mean less. Nothing here
 * is a link — there is no file behind any of it.
 */
function Elsewhere({ range }: { range: HistoryRange }) {
  const connectionQuery = useQuery({
    queryKey: ['scrobbles', 'connection'],
    queryFn: scrobbles.connection,
  });
  const connection = connectionQuery.data?.connection ?? null;

  const summaryQuery = useQuery({
    queryKey: ['scrobbles', 'summary', range],
    queryFn: () => scrobbles.summary(range),
    enabled: Boolean(connection),
  });
  const summary = summaryQuery.data?.summary;

  // Nothing connected is not a state worth a panel — Settings is where you go
  // to start, and this page shouldn't nag about a feature nobody asked for.
  if (!connection) return null;

  return (
    <section className="space-y-3">
      <SectionHeader title="Elsewhere" />
      <div className="surface space-y-5 p-5">
        <p className="text-xs leading-relaxed text-zinc-500">
          From <span className="font-medium text-zinc-400">{connection.label}</span>, by way of your
          Last.fm account. Counted separately from everything above: these are tracks the archive
          does not hold, so they stay out of your top tracks and your generated playlists.
        </p>

        {summaryQuery.isLoading || !summary ? (
          <p className="text-sm text-zinc-500">Working it out…</p>
        ) : summary.plays === 0 ? (
          <p className="text-sm text-zinc-500">
            Nothing scrobbled in this window yet. Play something on {connection.label} and it shows
            up within a minute or so.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Stat icon={<Music2 size={11} />} label="Plays" value={String(summary.plays)} />
              <Stat icon={<Radio size={11} />} label="Tracks" value={String(summary.tracks)} />
              <Stat icon={<Users size={11} />} label="Artists" value={String(summary.artists)} />
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <ExternalChart title="Top tracks" entries={summary.topTracks} />
              <ExternalChart title="Top artists" entries={summary.topArtists} />
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/** The same chart shape as the archive's, minus everything that links. */
function ExternalChart({ title, entries }: { title: string; entries: ExternalTop[] }) {
  if (entries.length === 0) return null;

  return (
    <div>
      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">{title}</p>
      <ol className="divide-y divide-white/[0.03]">
        {entries.map((entry, index) => (
          <li key={entry.key} className="flex items-center gap-3 py-2">
            <span className="w-5 shrink-0 text-center text-sm font-bold tabular-nums text-zinc-600">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-zinc-100">{entry.name}</span>
              {entry.subtitle && (
                <span className="block truncate text-xs text-zinc-600">{entry.subtitle}</span>
              )}
            </span>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-zinc-400">
              {entry.plays}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function RecapPage() {
  const [range, setRange] = useState<HistoryRange>('month');

  const recapQuery = useQuery({
    queryKey: ['history', 'recap', range],
    queryFn: () => history.recap(range),
  });

  const recap = recapQuery.data?.recap;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Your listening"
        subtitle="Built from what you have actually played here."
        actions={
          <div className="flex flex-wrap gap-1.5">
            {RANGES.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setRange(option.value)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  range === option.value
                    ? 'bg-accent-500 text-white'
                    : 'border border-white/10 text-zinc-400 hover:border-white/20 hover:text-zinc-200'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      />

      <WrappedPlaylists />

      {recapQuery.isError ? (
        <ErrorState error={recapQuery.error} onRetry={() => recapQuery.refetch()} />
      ) : recapQuery.isLoading || !recap ? (
        <p className="surface p-8 text-sm text-zinc-500">Working it out…</p>
      ) : recap.plays === 0 ? (
        <EmptyState
          icon={<Clock size={22} />}
          title="Nothing here yet"
          description="Play something for a minute or two and it starts showing up. A track counts once you have heard four minutes of it, or half of it — whichever comes first."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat icon={<Music2 size={11} />} label="Plays" value={String(recap.plays)} />
            <Stat
              icon={<Clock size={11} />}
              label="Listened"
              value={listeningTime(recap.msPlayed)}
            />
            <Stat icon={<Users size={11} />} label="Artists" value={String(recap.artists)} />
            <Stat icon={<Disc3 size={11} />} label="Albums" value={String(recap.albums)} />
          </div>

          {recap.peakHour !== null && (
            <p className="text-sm text-zinc-500">
              You listen most around{' '}
              <span className="font-semibold text-zinc-300">{hourLabel(recap.peakHour)}</span>, across{' '}
              <span className="font-semibold text-zinc-300">{recap.tracks}</span>{' '}
              {recap.tracks === 1 ? 'different track' : 'different tracks'}.
            </p>
          )}

          <Chart title="Top tracks" entries={recap.topTracks} showCover />
          <Chart title="Top artists" entries={recap.topArtists} showCover={false} />
          <Chart title="Top albums" entries={recap.topAlbums} showCover />
        </>
      )}

      <Elsewhere range={range} />
    </div>
  );
}
