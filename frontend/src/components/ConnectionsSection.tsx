import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Link2, Link2Off, Loader2 } from 'lucide-react';

import { scrobbles } from '../lib/api';

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
 * Last.fm is the bridge rather than the destination — Spotify scrobbles to it,
 * and this reads it back. There used to be a picker for the name a status is
 * shown under, which was never anything but a guess: Last.fm records *that* a
 * track was played and never which app played it. It is fixed to Spotify now.
 */
export function ConnectionsSection() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState('');

  const query = useQuery({ queryKey: ['scrobbles', 'connection'], queryFn: scrobbles.connection });
  const connection = query.data?.connection ?? null;

  // Seed the form from the connection once it arrives, so editing an existing
  // one starts from what is there rather than an empty box.
  useEffect(() => {
    if (!connection) return;
    setUsername((current) => current || connection.username);
  }, [connection]);

  const save = useMutation({
    mutationFn: () => scrobbles.connect({ username: username.trim() }),
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
        Connect a Last.fm account and what you play on Spotify shows up in your status and under
        Elsewhere. Those plays stay out of the archive's own stats.
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
