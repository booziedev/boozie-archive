import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Eye, Loader2, Pencil, Plus, UserRound, Users, X } from 'lucide-react';

import { Avatar } from './Avatar';
import { playlists, social } from '../lib/api';
import type { Playlist, PlaylistRole } from '../lib/types';

const ROLES: { value: PlaylistRole; label: string; hint: string }[] = [
  { value: 'viewer', label: 'Viewer', hint: 'Can listen and download it.' },
  { value: 'collaborator', label: 'Collaborator', hint: 'Can also add and remove tracks.' },
];

/**
 * Who is in a playlist, and what they may do.
 *
 * Everyone who can open the playlist can see the list — knowing who else is in
 * a shared thing is part of it being shared — but only the owner can change a
 * role or invite anyone, and only their friends can be invited.
 */
export function PlaylistMembers({ playlist, onClose }: { playlist: Playlist; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [inviting, setInviting] = useState(false);

  const membersQuery = useQuery({
    queryKey: ['playlist', playlist.id, 'members'],
    queryFn: () => playlists.members(playlist.id),
  });
  const friendsQuery = useQuery({
    queryKey: ['friends'],
    queryFn: social.friends,
    enabled: inviting && playlist.isOwner,
  });

  const refresh = (members: { members: unknown }) => {
    queryClient.setQueryData(['playlist', playlist.id, 'members'], members);
    queryClient.invalidateQueries({ queryKey: ['playlist', playlist.id] });
    queryClient.invalidateQueries({ queryKey: ['playlists'] });
  };

  const setRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: PlaylistRole }) =>
      playlists.setMember(playlist.id, userId, role),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: (userId: string) => playlists.removeMember(playlist.id, userId),
    onSuccess: refresh,
  });

  const members = membersQuery.data?.members ?? [];
  const invited = new Set(members.map((member) => member.userId));
  const invitable = (friendsQuery.data?.friends ?? []).filter((friend) => !invited.has(friend.id));
  const error = setRole.error ?? remove.error;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div
        role="presentation"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in"
      />

      <div className="surface relative flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-b-none sm:rounded-2xl animate-scale-in">
        <header className="flex items-center justify-between border-b border-white/5 px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
            <Users size={16} className="text-accent-400" />
            Shared with
          </span>
          <button type="button" onClick={onClose} aria-label="Close" className="icon-btn h-8 w-8">
            <X size={16} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
          {/* The owner, first and unchangeable. */}
          <div className="flex items-center gap-3 rounded-xl px-2 py-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/5">
              <UserRound size={16} className="text-zinc-400" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-zinc-100">
                {playlist.ownerDisplayName || playlist.ownerUsername}
              </span>
              <span className="block truncate text-xs text-zinc-600">Owner</span>
            </span>
          </div>

          {membersQuery.isLoading ? (
            <p className="px-3 py-6 text-center text-sm text-zinc-500">Loading…</p>
          ) : members.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm leading-relaxed text-zinc-500">
              Nobody else has been invited yet.
              {playlist.visibility !== 'private' && ' It is still visible under the setting above.'}
            </p>
          ) : (
            members.map((member) => (
              <div key={member.userId} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/5">
                <Avatar profile={{ ...member, id: member.userId }} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-zinc-100">
                    {member.displayName || member.username}
                  </span>
                  <span className="block truncate text-xs text-zinc-600">@{member.username}</span>
                </span>

                {playlist.isOwner ? (
                  <>
                    <select
                      value={member.role}
                      disabled={setRole.isPending}
                      onChange={(event) =>
                        setRole.mutate({ userId: member.userId, role: event.target.value as PlaylistRole })
                      }
                      aria-label={`Role for ${member.username}`}
                      className="rounded-lg border border-white/10 bg-ink-850 px-2 py-1 text-xs text-zinc-200 focus:border-accent-500/50 focus:outline-none"
                    >
                      {ROLES.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(member.userId)}
                      aria-label={`Remove ${member.username}`}
                      className="icon-btn h-8 w-8 hover:text-red-400"
                    >
                      <X size={14} />
                    </button>
                  </>
                ) : (
                  <span className="pill">
                    {member.role === 'collaborator' ? <Pencil size={10} /> : <Eye size={10} />}
                    {member.role === 'collaborator' ? 'Collaborator' : 'Viewer'}
                  </span>
                )}
              </div>
            ))
          )}

          {/* Inviting, owner only. */}
          {playlist.isOwner && inviting && (
            <div className="mt-1 border-t border-white/5 pt-1">
              {friendsQuery.isLoading ? (
                <p className="px-3 py-4 text-center text-xs text-zinc-500">Loading friends…</p>
              ) : invitable.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs leading-relaxed text-zinc-500">
                  {(friendsQuery.data?.friends ?? []).length === 0
                    ? 'You have no friends to invite yet.'
                    : 'Everyone you know is already in this playlist.'}
                </p>
              ) : (
                invitable.map((friend) => (
                  <button
                    key={friend.id}
                    type="button"
                    disabled={setRole.isPending}
                    onClick={() => setRole.mutate({ userId: friend.id, role: 'viewer' })}
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-white/5 disabled:opacity-60"
                  >
                    <Avatar profile={friend} size={32} />
                    <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
                      {friend.displayName || friend.username}
                    </span>
                    {setRole.isPending && setRole.variables?.userId === friend.id ? (
                      <Loader2 size={14} className="animate-spin text-zinc-500" />
                    ) : (
                      <Plus size={14} className="text-zinc-500" />
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {error && (
          <p className="border-t border-white/5 px-4 py-2 text-xs text-red-400">
            {error instanceof Error ? error.message : 'That did not work.'}
          </p>
        )}

        {playlist.isOwner && (
          <footer className="border-t border-white/5 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={() => setInviting((value) => !value)}
              className="btn-ghost w-full justify-center"
            >
              {inviting ? <Check size={15} /> : <Plus size={15} />}
              {inviting ? 'Done' : 'Invite a friend'}
            </button>
            <p className="px-2 pt-1.5 text-[11px] leading-relaxed text-zinc-600">
              Invited people can open this playlist whatever its visibility says. Viewers can
              listen and download; collaborators can also change what is in it.
            </p>
          </footer>
        )}
      </div>
    </div>
  );
}
