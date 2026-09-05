import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Clock, MessageSquare, Search, UserMinus, UserPlus, Users, X } from 'lucide-react';

import { Avatar } from '../components/Avatar';
import { ListeningNow } from '../components/ListeningNow';
import { PageHeader, SectionHeader } from '../components/PageHeader';
import { EmptyState, ErrorState } from '../components/states';
import { social } from '../lib/api';
import { useDebounced } from '../hooks/useDebounced';
import type { PublicProfile } from '../lib/types';

/** Friends list, incoming/outgoing requests, and a directory search. */
export function FriendsPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 300);
  const [error, setError] = useState<string | null>(null);

  const friendsQuery = useQuery({
    queryKey: ['friends'],
    queryFn: social.friends,
    // Rows carry each friend's current track, so this is also the status poll.
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
  const searchQuery = useQuery({
    queryKey: ['users', 'search', debounced],
    queryFn: () => social.searchUsers(debounced),
    enabled: debounced.trim().length >= 1,
  });

  function refresh() {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ['friends'] }),
      queryClient.invalidateQueries({ queryKey: ['users', 'search'] }),
      queryClient.invalidateQueries({ queryKey: ['social', 'badges'] }),
    ]);
  }
  const onError = (mutationError: unknown) =>
    setError(mutationError instanceof Error ? mutationError.message : 'That action failed.');

  const add = useMutation({ mutationFn: social.addFriend, onSuccess: refresh, onError });
  const accept = useMutation({ mutationFn: social.acceptFriend, onSuccess: refresh, onError });
  const remove = useMutation({ mutationFn: social.removeFriend, onSuccess: refresh, onError });

  const friends = friendsQuery.data?.friends ?? [];
  const incoming = friendsQuery.data?.incoming ?? [];
  const outgoing = friendsQuery.data?.outgoing ?? [];

  /** One row, with whatever action matches the current relationship. */
  function Row({
    profile,
    action,
  }: {
    profile: PublicProfile;
    action?: React.ReactNode;
  }) {
    return (
      <div className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/[0.03]">
        <Link to={`/u/${profile.username}`} className="flex min-w-0 flex-1 items-center gap-3">
          <Avatar profile={profile} size={40} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-zinc-100">
              {profile.displayName || profile.username}
            </span>
            {profile.listeningNow ? (
              <ListeningNow now={profile.listeningNow} compact />
            ) : (
              <span className="block truncate text-xs text-zinc-600">@{profile.username}</span>
            )}
          </span>
        </Link>
        <div className="flex shrink-0 items-center gap-1">{action}</div>
      </div>
    );
  }

  return (
    <div className="space-y-9">
      <PageHeader title="Friends" subtitle="Share music and message people in the archive." />

      {error && (
        <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
          {error}
        </p>
      )}

      {/* ---------------------------- find people ------------------------ */}
      <section className="surface p-4">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-3 text-zinc-600" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find someone by username…"
            aria-label="Find people"
            autoCapitalize="none"
            autoCorrect="off"
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2.5 pl-10 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-accent-500/50 focus:outline-none"
          />
        </div>

        {debounced.trim().length >= 1 && (
          <div className="mt-2">
            {searchQuery.isLoading ? (
              <p className="px-2 py-4 text-sm text-zinc-500">Searching…</p>
            ) : (searchQuery.data?.users.length ?? 0) === 0 ? (
              <p className="px-2 py-4 text-sm text-zinc-500">Nobody matches “{debounced}”.</p>
            ) : (
              searchQuery.data!.users.map((profile) => (
                <Row
                  key={profile.id}
                  profile={profile}
                  action={
                    profile.friendStatus === 'friends' ? (
                      <span className="pill">Friends</span>
                    ) : profile.friendStatus === 'pending_out' ? (
                      <span className="pill">
                        <Clock size={11} />
                        Requested
                      </span>
                    ) : profile.friendStatus === 'pending_in' ? (
                      <span className="pill pill-accent">Wants to add you</span>
                    ) : profile.friendStatus === 'blocked' ? (
                      <span className="pill">Blocked</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => add.mutate(profile.id)}
                        disabled={add.isPending}
                        className="btn-ghost px-3 py-1.5 text-xs"
                      >
                        <UserPlus size={14} />
                        Add
                      </button>
                    )
                  }
                />
              ))
            )}
          </div>
        )}
      </section>

      {friendsQuery.isError ? (
        <ErrorState error={friendsQuery.error} onRetry={() => friendsQuery.refetch()} />
      ) : (
        <>
          {incoming.length > 0 && (
            <section>
              <SectionHeader title={`Friend requests (${incoming.length})`} />
              <div className="surface p-1.5">
                {incoming.map((profile) => (
                  <Row
                    key={profile.id}
                    profile={profile}
                    action={
                      <>
                        <button
                          type="button"
                          onClick={() => accept.mutate(profile.friendshipId)}
                          className="btn-primary px-3 py-1.5 text-xs"
                        >
                          <Check size={14} />
                          Accept
                        </button>
                        <button
                          type="button"
                          onClick={() => remove.mutate(profile.id)}
                          aria-label={`Decline ${profile.username}`}
                          className="icon-btn h-8 w-8"
                        >
                          <X size={15} />
                        </button>
                      </>
                    }
                  />
                ))}
              </div>
            </section>
          )}

          {outgoing.length > 0 && (
            <section>
              <SectionHeader title={`Sent requests (${outgoing.length})`} />
              <div className="surface p-1.5">
                {outgoing.map((profile) => (
                  <Row
                    key={profile.id}
                    profile={profile}
                    action={
                      <button
                        type="button"
                        onClick={() => remove.mutate(profile.id)}
                        className="btn-ghost px-3 py-1.5 text-xs"
                      >
                        Cancel
                      </button>
                    }
                  />
                ))}
              </div>
            </section>
          )}

          <section>
            <SectionHeader title={`Friends (${friends.length})`} />
            {friendsQuery.isLoading ? (
              <div className="surface p-6 text-sm text-zinc-500">Loading…</div>
            ) : friends.length === 0 ? (
              <EmptyState
                icon={<Users size={24} />}
                title="No friends yet"
                description="Search for someone above and send a request. Once they accept you can message them and share albums."
              />
            ) : (
              <div className="surface p-1.5">
                {friends.map((friend) => (
                  <Row
                    key={friend.id}
                    profile={friend}
                    action={
                      <>
                        <Link
                          to={`/messages/${friend.id}`}
                          aria-label={`Message ${friend.username}`}
                          className="icon-btn h-9 w-9"
                        >
                          <MessageSquare size={16} />
                        </Link>
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Remove ${friend.username} from your friends?`)) {
                              remove.mutate(friend.id);
                            }
                          }}
                          aria-label={`Remove ${friend.username}`}
                          className="icon-btn h-9 w-9 hover:text-red-400"
                        >
                          <UserMinus size={16} />
                        </button>
                      </>
                    }
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
