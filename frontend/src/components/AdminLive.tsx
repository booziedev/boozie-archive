import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  Eye,
  Loader2,
  Lock,
  LockOpen,
  Radio,
  SkipForward,
  Square,
  Timer,
} from 'lucide-react';

import { Avatar } from './Avatar';
import { CoverImage } from './CoverImage';
import { ErrorState } from './states';
import { SectionHeader } from './PageHeader';
import { admin } from '../lib/api';
import { formatDuration } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import type { LiveListener } from '../lib/types';

/**
 * How often the rows are refetched.
 *
 * This used to be 3s "to match the presence poll", which matched the wrong
 * end: listeners *read* every 3s but only *report* every 20s, so polling
 * faster here bought nothing. What actually made the panel live was reporting
 * on every event and deriving the position between them — see `livePosition`
 * below. A second is enough to catch an event promptly now that there is one.
 */
const POLL_MS = 1_000;
/** How often the derived position is recomputed. Cheap, and looks continuous. */
const TICK_MS = 500;

const DURATIONS = [
  { minutes: 5, label: '5m' },
  { minutes: 15, label: '15m' },
  { minutes: 60, label: '1h' },
  { minutes: 60 * 24, label: '1d' },
];

const HOLDS = [
  { minutes: 1, label: '1m' },
  { minutes: 5, label: '5m' },
  { minutes: 15, label: '15m' },
  { minutes: 60, label: '1h' },
];

/** "in 4 minutes" / "in 2 hours" — what is left of a timeout. */
function untilLabel(iso: string): string {
  const minutes = Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 60_000));
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m left`;
}

/** Seconds remaining on a hold, which is short enough to count down properly. */
function holdLabel(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((new Date(iso).getTime() - now) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** How long ago the status was last written, so a stale row is obvious. */
function ago(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  return seconds < 10 ? 'now' : `${seconds}s ago`;
}

/**
 * Where the track has actually got to, rather than where it was last reported.
 *
 * A listener reports every twenty seconds, so `position` is a sample up to
 * that old. Showing it raw made the bar a staircase that was always between 0
 * and 20 seconds behind and jumped a whole beat at a time — which is what
 * "the progress doesn't update for 24 seconds" was. Adding the time elapsed
 * since the sample gives a bar that simply moves.
 *
 * `skew` corrects for the two machines' clocks disagreeing: the server's own
 * time comes back with the rows, so the elapsed term is measured against the
 * clock that wrote `updatedAt`, not the admin's.
 *
 * It assumes a second of playback per second of wall clock, so a listener who
 * is buffering or playing at a non-1x speed drifts slowly. Every heartbeat
 * corrects it, and the error is bounded by the beat interval.
 */
function livePosition(listener: LiveListener, now: number, skew: number): number {
  if (!listener.isPlaying) return listener.position;
  const elapsed = (now - skew - new Date(listener.updatedAt).getTime()) / 1000;
  const derived = listener.position + Math.max(0, elapsed);
  return listener.duration ? Math.min(derived, listener.duration) : derived;
}

function ListenerRow({
  listener,
  isSelf,
  now,
  skew,
  onHold,
  onRelease,
  onCommand,
  onTimeout,
  busy,
}: {
  listener: LiveListener;
  isSelf: boolean;
  now: number;
  skew: number;
  onHold: (minutes: number) => void;
  onRelease: () => void;
  onCommand: (command: 'skip' | 'stop') => void;
  onTimeout: (minutes: number) => void;
  busy: boolean;
}) {
  const [timeoutOpen, setTimeoutOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  /*
   * Playing on Spotify, Apple Music or wherever, read through their Last.fm
   * account. Worth showing — it is genuinely what they are listening to — but
   * flagged, because these controls talk to this site's player and nothing else.
   */
  const external = listener.source !== 'archive';
  const held = Boolean(listener.holdUntil && new Date(listener.holdUntil).getTime() > now);
  const position = livePosition(listener, now, skew);
  const progress =
    listener.duration && listener.duration > 0
      ? Math.min(100, (position / listener.duration) * 100)
      : 0;

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-white/[0.03] px-3 py-3 last:border-0 sm:flex-nowrap">
      <Avatar profile={{ ...listener, id: listener.userId }} size={36} />

      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5 truncate text-sm text-zinc-100">
          {listener.displayName || listener.username}
          {listener.role === 'admin' && <span className="pill">admin</span>}
          {external && <span className="pill text-zinc-400">{listener.source}</span>}
          {held && listener.holdUntil && (
            <span className="pill text-rose-300">held {holdLabel(listener.holdUntil, now)}</span>
          )}
          {listener.timeoutUntil && (
            <span className="pill text-amber-300">{untilLabel(listener.timeoutUntil)}</span>
          )}
        </p>
        <p className="truncate text-xs text-zinc-500">
          @{listener.username} · {ago(listener.updatedAt, now)}
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
                {formatDuration(position)} / {formatDuration(listener.duration)}
              </span>
            </span>
          ) : null}
        </span>
      </div>

      <div className="relative flex items-center gap-1">
        {/*
          Skip and stop are one-shot instructions; the hold is a state. All
          three are pointless against somebody playing elsewhere, which the
          tooltip says rather than leaving a dead button to be discovered.
        */}
        <button
          type="button"
          onClick={() => onCommand('skip')}
          disabled={busy || external || held || !listener.isPlaying}
          title={
            external
              ? `They are listening on ${listener.source} — nothing here can reach that`
              : 'Skip to their next track'
          }
          className="icon-btn h-8 w-8 disabled:opacity-30"
          aria-label={`Skip ${listener.username}'s track`}
        >
          <SkipForward size={14} />
        </button>

        <button
          type="button"
          onClick={() => onCommand('stop')}
          disabled={busy || external || held || !listener.isPlaying}
          title={
            external
              ? `They are listening on ${listener.source} — nothing here can reach that`
              : 'Stop them and empty their queue'
          }
          className="icon-btn h-8 w-8 disabled:opacity-30"
          aria-label={`Stop ${listener.username}`}
        >
          <Square size={13} />
        </button>

        <button
          type="button"
          onClick={() => (held ? onRelease() : setHoldOpen((value) => !value))}
          disabled={busy || external || isSelf}
          aria-expanded={holdOpen}
          title={
            external
              ? `They are listening on ${listener.source} — nothing here can stop that`
              : isSelf
                ? "You can't hold your own playback"
                : held
                  ? 'Lift the hold'
                  : 'Hold their playback'
          }
          className={`icon-btn h-8 w-8 disabled:opacity-30 ${held ? 'text-rose-400' : ''}`}
          aria-label={held ? `Release ${listener.username}` : `Hold ${listener.username}`}
        >
          {busy ? (
            <Loader2 size={14} className="animate-spin" />
          ) : held ? (
            <LockOpen size={14} />
          ) : (
            <Lock size={14} />
          )}
        </button>

        {!isSelf && (
          <button
            type="button"
            onClick={() => setTimeoutOpen((value) => !value)}
            aria-expanded={timeoutOpen}
            title="Lock them out of the archive for a while"
            aria-label={`Time out ${listener.username}`}
            className={`icon-btn h-8 w-8 ${listener.timeoutUntil ? 'text-amber-400' : ''}`}
          >
            <Timer size={14} />
          </button>
        )}

        {holdOpen && !held && (
          <div className="absolute right-0 top-full z-40 mt-1 w-44 rounded-xl border border-white/10 bg-ink-850 p-1.5 shadow-lift">
            <p className="px-1.5 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Hold playback for
            </p>
            <div className="grid grid-cols-2 gap-1">
              {HOLDS.map((option) => (
                <button
                  key={option.minutes}
                  type="button"
                  onClick={() => {
                    onHold(option.minutes);
                    setHoldOpen(false);
                  }}
                  className="rounded-lg border border-white/10 px-1 py-1.5 text-xs text-zinc-300 transition-colors hover:border-white/20 hover:bg-white/5"
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="px-1.5 pt-1.5 text-[10px] leading-relaxed text-zinc-600">
              They stay paused and the server refuses their audio until it lifts.
            </p>
          </div>
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
  const [now, setNow] = useState(() => Date.now());

  const query = useQuery({
    queryKey: ['admin', 'live'],
    queryFn: admin.live,
    refetchInterval: POLL_MS,
    // The global default is five minutes, which is right for the library and
    // wrong for this: without it, coming back to the tab painted rows from
    // the last time it was open and waited a whole poll to correct them.
    staleTime: 0,
  });

  /*
   * Drives the derived position and the countdowns between fetches. This is
   * what makes the bar move continuously rather than jumping when data lands.
   */
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  /*
   * How far this browser's clock is ahead of the Pi's, measured when the rows
   * arrive. Without it a phone a few seconds out would show every bar offset
   * by that much, or stuck at zero.
   */
  const skewRef = useRef(0);
  const serverTime = query.data?.serverTime;
  useEffect(() => {
    if (serverTime) skewRef.current = Date.now() - new Date(serverTime).getTime();
  }, [serverTime]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'live'] });
  const onError = (actionError: unknown) => {
    setError(actionError instanceof Error ? actionError.message : 'That did not work.');
    setPending(null);
  };
  const onDone = async () => {
    setError(null);
    setPending(null);
    await refresh();
  };

  const hold = useMutation<unknown, Error, { id: string; minutes: number }>({
    mutationFn: ({ id, minutes }) => admin.holdUser(id, minutes),
    onSuccess: onDone,
    onError,
  });

  const release = useMutation({
    mutationFn: (id: string) => admin.releaseUser(id),
    onSuccess: onDone,
    onError,
  });

  const command = useMutation<unknown, Error, { id: string; command: 'skip' | 'stop' }>({
    mutationFn: ({ id, command: instruction }) => admin.commandUser(id, instruction),
    onSuccess: onDone,
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
                now={now}
                skew={skewRef.current}
                busy={
                  pending === listener.userId &&
                  (hold.isPending || release.isPending || command.isPending)
                }
                onHold={(minutes) => {
                  setPending(listener.userId);
                  hold.mutate({ id: listener.userId, minutes });
                }}
                onRelease={() => {
                  setPending(listener.userId);
                  release.mutate(listener.userId);
                }}
                onCommand={(instruction) => {
                  setPending(listener.userId);
                  command.mutate({ id: listener.userId, command: instruction });
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
