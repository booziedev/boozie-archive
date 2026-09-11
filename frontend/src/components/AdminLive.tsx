import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Eye, Loader2, Pause, Radio, Timer } from 'lucide-react';

import { Avatar } from './Avatar';
import { CoverImage } from './CoverImage';
import { ErrorState } from './states';
import { SectionHeader } from './PageHeader';
import { admin } from '../lib/api';
import { formatDuration } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import type { LiveListener } from '../lib/types';

/** Matches the presence poll, so the tab is never further behind than a listener is. */
const POLL_MS = 3_000;

const DURATIONS = [
  { minutes: 5, label: '5m' },
  { minutes: 15, label: '15m' },
  { minutes: 60, label: '1h' },
  { minutes: 60 * 24, label: '1d' },
];

/** "in 4 minutes" / "in 2 hours" — what is left of a timeout. */
function untilLabel(iso: string): string {
  const minutes = Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 60_000));
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m left`;
}

/** How long ago the status was last written, so a stale row is obvious. */
function ago(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return seconds < 10 ? 'now' : `${seconds}s ago`;
}

function ListenerRow({
  listener,
  isSelf,
  onPause,
  onTimeout,
  busy,
}: {
  listener: LiveListener;
  isSelf: boolean;
  onPause: () => void;
  onTimeout: (minutes: number) => void;
  busy: boolean;
}) {
  const [timeoutOpen, setTimeoutOpen] = useState(false);
  /*
   * Playing on Spotify, Apple Music or wherever, read through their Last.fm
   * account. Worth showing — it is genuinely what they are listening to — but
   * flagged, because force-pause talks to this site's player and nothing else.
   */
  const external = listener.source !== 'archive';
  const progress =
    listener.duration && listener.duration > 0
      ? Math.min(100, (listener.position / listener.duration) * 100)
      : 0;

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-white/[0.03] px-3 py-3 last:border-0 sm:flex-nowrap">
      <Avatar profile={{ ...listener, id: listener.userId }} size={36} />

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm text-zinc-100">
          {listener.displayName || listener.username}
          {listener.role === 'admin' && <span className="pill">admin</span>}
          {external && <span className="pill text-zinc-400">{listener.source}</span>}
          {listener.timeoutUntil && (
            <span className="pill text-amber-300">{untilLabel(listener.timeoutUntil)}</span>
          )}
        </p>
        <p className="truncate text-xs text-zinc-500">
          @{listener.username} · {ago(listener.updatedAt)}
        </p>
      </div>

      <div className="flex min-w-0 flex-[2] items-center gap-2.5">
        {listener.isRadio || external ? (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/5">
            <Radio size={16} className={external ? 'text-zinc-500' : 'text-accent-300'} />
          </span>
        ) : (
          <CoverImage
            id={listener.coverId ?? listener.albumId ?? ''}
            name={listener.album ?? listener.title}
            size={128}
            rounded="rounded-lg"
            className="h-10 w-10 shrink-0"
          />
        )}

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            {listener.isPlaying && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
            )}
            <span className="truncate text-sm text-zinc-200">{listener.title}</span>
          </span>
          <span className="block truncate text-xs text-zinc-600">
            {listener.isRadio ? 'Live radio' : listener.artist}
          </span>

          {!listener.isRadio && !external && listener.duration ? (
            <span className="mt-1 flex items-center gap-2">
              <span className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/10">
                <span
                  className="block h-full bg-accent-500/70"
                  style={{ width: `${progress}%` }}
                />
              </span>
              <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">
                {formatDuration(listener.position)} / {formatDuration(listener.duration)}
              </span>
            </span>
          ) : null}
        </span>
      </div>

      <div className="relative flex items-center gap-1">
        <button
          type="button"
          onClick={onPause}
          disabled={busy || !listener.isPlaying || external}
          title={
            external
              ? `They are listening on ${listener.source} — nothing here can stop that`
              : listener.isPlaying
                ? 'Stop their playback'
                : 'They are not playing'
          }
          className="icon-btn h-8 w-8 disabled:opacity-30"
          aria-label={`Pause ${listener.username}`}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Pause size={14} />}
        </button>

        {!isSelf && (
          <button
            type="button"
            onClick={() => setTimeoutOpen((value) => !value)}
            aria-expanded={timeoutOpen}
            title="Pause their access for a while"
            aria-label={`Time out ${listener.username}`}
            className={`icon-btn h-8 w-8 ${listener.timeoutUntil ? 'text-amber-400' : ''}`}
          >
            <Timer size={14} />
          </button>
        )}

        {timeoutOpen && (
          <div className="absolute right-0 top-full z-40 mt-1 w-40 rounded-xl border border-white/10 bg-ink-850 p-1.5 shadow-lift">
            <p className="px-1.5 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Pause access for
            </p>
            <div className="grid grid-cols-2 gap-1">
              {DURATIONS.map((option) => (
                <button
                  key={option.minutes}
                  type="button"
                  onClick={() => {
                    onTimeout(option.minutes);
                    setTimeoutOpen(false);
                  }}
                  className="rounded-lg border border-white/10 px-1 py-1.5 text-xs text-zinc-300 transition-colors hover:border-white/20 hover:bg-white/5"
                >
                  {option.label}
                </button>
              ))}
            </div>
            {listener.timeoutUntil && (
              <button
                type="button"
                onClick={() => {
                  onTimeout(0);
                  setTimeoutOpen(false);
                }}
                className="btn-ghost mt-1.5 w-full justify-center px-2 py-1 text-xs"
              >
                Lift it now
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Who is listening, right now.
 *
 * This shows everyone playing something, whatever their own "who can see what
 * I'm listening to" setting says — that setting is about other members, not
 * about the admin of the server they are on. Worth knowing rather than
 * discovering.
 */
export function AdminLive() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['admin', 'live'],
    queryFn: admin.live,
    refetchInterval: POLL_MS,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'live'] });
  const onError = (actionError: unknown) => {
    setError(actionError instanceof Error ? actionError.message : 'That did not work.');
    setPending(null);
  };

  const pause = useMutation({
    mutationFn: (id: string) => admin.pauseUser(id),
    onSuccess: async () => {
      setError(null);
      setPending(null);
      await refresh();
    },
    onError,
  });

  // Zero minutes means "lift it", so one control covers both directions.
  const timeout = useMutation<unknown, Error, { id: string; minutes: number }>({
    mutationFn: ({ id, minutes }) =>
      minutes > 0 ? admin.timeoutUser(id, minutes) : admin.clearTimeout(id),
    onSuccess: async () => {
      setError(null);
      await refresh();
    },
    onError,
  });

  const listeners = query.data?.listeners ?? [];
  const timedOut = query.data?.timedOut ?? [];
  // Somebody timed out while not playing anything would otherwise be invisible.
  const listening = new Set(listeners.map((listener) => listener.userId));
  const timedOutOnly = timedOut.filter((entry) => !listening.has(entry.userId));

  return (
    <div className="space-y-8">
      {error && (
        <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      <section>
        <SectionHeader
          title={`Listening now (${listeners.length})`}
          action={
            <span className="flex items-center gap-1.5 text-xs text-zinc-600">
              <Eye size={12} />
              Shown regardless of each person's status privacy
            </span>
          }
        />

        {query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : query.isLoading ? (
          <p className="surface p-8 text-center text-sm text-zinc-500">Looking…</p>
        ) : listeners.length === 0 ? (
          <p className="surface p-8 text-center text-sm text-zinc-500">
            Nobody is playing anything at the moment.
          </p>
        ) : (
          <div className="surface overflow-hidden">
            {listeners.map((listener) => (
              <ListenerRow
                key={listener.userId}
                listener={listener}
                isSelf={listener.userId === user?.id}
                busy={pending === listener.userId && pause.isPending}
                onPause={() => {
                  setPending(listener.userId);
                  pause.mutate(listener.userId);
                }}
                onTimeout={(minutes) => timeout.mutate({ id: listener.userId, minutes })}
              />
            ))}
          </div>
        )}
      </section>

      {timedOutOnly.length > 0 && (
        <section>
          <SectionHeader title={`Timed out (${timedOutOnly.length})`} />
          <div className="surface overflow-hidden">
            {timedOutOnly.map((entry) => (
              <div
                key={entry.userId}
                className="flex items-center gap-3 border-b border-white/[0.03] px-3 py-3 last:border-0"
              >
                <Avatar profile={{ ...entry, id: entry.userId }} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-zinc-100">
                    {entry.displayName || entry.username}
                  </span>
                  <span className="block truncate text-xs text-amber-300/80">
                    {untilLabel(entry.timeoutUntil)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => timeout.mutate({ id: entry.userId, minutes: 0 })}
                  className="btn-ghost px-2 py-1 text-xs"
                >
                  <Ban size={13} />
                  Lift
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
