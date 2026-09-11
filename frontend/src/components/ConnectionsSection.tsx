import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Link2, Link2Off, Loader2 } from 'lucide-react';

import { scrobbles } from '../lib/api';
import type { ServiceLabel } from '../lib/types';

/** "4 minutes ago", or "just now" for anything inside a minute. */
function ago(iso: string | null): string {
  if (!iso) return 'never';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * Connecting a Last.fm account, so listening done elsewhere shows up here.
 *
 * Last.fm is the bridge rather than the destination: Spotify, Apple Music,
 * Tidal and most desktop players can all scrobble to it, so one connection
 * covers whichever of them somebody actually uses.
 *
 * The service picker is honest about what it is. Last.fm records *that* a track
 * was played, never which app played it, so the name shown in a status is the
 * one chosen here and the copy below says so rather than implying detection.
 */
export function ConnectionsSection() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [label, setLabel] = useState<ServiceLabel>('Spotify');

  const query = useQuery({ queryKey: ['scrobbles', 'connection'], queryFn: scrobbles.connection });
  const connection = query.data?.connection ?? null;
  const labels = query.data?.labels ?? [];

  // Seed the form from the connection once it arrives, so editing an existing
  // one starts from what is there rather than an empty box.
  useEffect(() => {
    if (!connection) return;
    setUsername((current) => current || connection.username);
    setLabel(connection.label);
  }, [connection]);

  const save = useMutation({
    mutationFn: () => scrobbles.connect({ username: username.trim(), label }),
    onMutate: () => setError(null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['scrobbles'] });
      void queryClient.invalidateQueries({ queryKey: ['presence', 'live'] });
    },
    onError: (saveError) =>
      setError(saveError instanceof Error ? saveError.message : 'Could not connect that account.'),
  });

  const remove = useMutation({
    mutationFn: scrobbles.disconnect,
    onMutate: () => setError(null),
    onSuccess: () => {
      setUsername('');
      void queryClient.invalidateQueries({ queryKey: ['scrobbles'] });
      void queryClient.invalidateQueries({ queryKey: ['presence', 'live'] });
    },
    onError: (removeError) =>
      setError(removeError instanceof Error ? removeError.message : 'Could not disconnect.'),
  });

  const busy = save.isPending || remove.isPending;
  const unconfigured = connection ? !connection.configured : false;

  return (
    <section className="surface space-y-5 p-5">
      <div className="flex items-center gap-2">
        <Link2 size={17} className="text-accent-400" />
        <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-300">
          Listening elsewhere
        </h2>
        {busy && <Loader2 size={14} className="animate-spin text-zinc-500" />}
      </div>

      <p className="text-xs leading-relaxed text-zinc-500">
        Connect a Last.fm account and whatever you play on Spotify, Apple Music, Tidal or a desktop
        player shows up here too — in your status while it is on, and under Elsewhere in Your
        Listening afterwards. Those plays are kept apart from the archive's own: they never count
        towards your top tracks and never land in a generated playlist, because there is no file
        here to play.
      </p>

      {connection && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
          <CheckCircle2 size={15} className="shrink-0 text-emerald-400" />
          <span className="text-sm text-zinc-200">
            Connected as <span className="font-medium">{connection.username}</span>
          </span>
          <span className="text-xs text-zinc-600">
            {connection.lastError
              ? connection.lastError
              : `checked ${ago(connection.lastPolledAt)}${
                  connection.lastScrobbleAt ? ` · last scrobble ${ago(connection.lastScrobbleAt)}` : ''
                }`}
          </span>
        </div>
      )}

      {unconfigured && (
        <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-xs leading-relaxed text-amber-200/80">
          This server has no Last.fm API key, so nothing is being fetched. Whoever runs it needs to
          create one at last.fm/api/account/create and set LASTFM_API_KEY.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,11rem)]">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-zinc-400">Last.fm username</span>
          <input
            type="text"
            value={username}
            maxLength={15}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="yourname"
            disabled={busy}
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-accent-500/50 focus:outline-none disabled:opacity-60"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-zinc-400">Shown as</span>
          <select
            value={label}
            disabled={busy}
            onChange={(event) => setLabel(event.target.value as ServiceLabel)}
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-100 focus:border-accent-500/50 focus:outline-none disabled:opacity-60"
          >
            {(labels.length ? labels : (['Last.fm'] as ServiceLabel[])).map((option) => (
              <option key={option} value={option} className="bg-zinc-900">
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="text-xs leading-relaxed text-zinc-600">
        Last.fm records that you played something, never which app you played it in — so the name
        above is the one your status will use because you picked it, not because we detected it.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={busy || username.trim().length < 2}
          className="btn-primary disabled:opacity-50"
        >
          {connection ? 'Save' : 'Connect'}
        </button>
        {connection && (
          <button
            type="button"
            onClick={() => remove.mutate()}
            disabled={busy}
            className="btn-ghost text-zinc-400 disabled:opacity-50"
          >
            <Link2Off size={15} />
            Disconnect
          </button>
        )}
      </div>

      {query.isError && <p className="text-xs text-red-400">Could not load your connections.</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </section>
  );
}
