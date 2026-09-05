import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Loader2, Send, Share2, X } from 'lucide-react';

import { Avatar } from './Avatar';
import { social } from '../lib/api';
import type { Attachment } from '../lib/types';

/** A piece of the library, as opposed to a GIF, an emoji or a party invite. */
function isLibraryItem(
  attachment: Attachment,
): attachment is Extract<Attachment, { kind: 'album' | 'artist' | 'track' }> {
  return attachment.kind === 'album' || attachment.kind === 'artist' || attachment.kind === 'track';
}

/**
 * "Send to a friend" sheet.
 *
 * Sharing is a direct message with an attachment, so a shared album arrives in
 * the same conversation as everything else and stays private to the two people
 * in it — there are no public links to leak.
 */
export function ShareDialog({
  attachment,
  onClose,
}: {
  attachment: Attachment;
  onClose: () => void;
}) {
  const friendsQuery = useQuery({ queryKey: ['friends'], queryFn: social.friends });
  const [note, setNote] = useState('');
  const [sentTo, setSentTo] = useState<string[]>([]);

  const send = useMutation({
    mutationFn: async (friendId: string) => {
      const { threadId } = await social.openThread(friendId);
      await social.sendMessage(threadId, { attachment });
      if (note.trim()) await social.sendMessage(threadId, { body: note.trim() });
      return friendId;
    },
    onSuccess: (friendId) => setSentTo((current) => [...current, friendId]),
  });

  const friends = friendsQuery.data?.friends ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div
        role="presentation"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in"
      />

      <div className="surface relative w-full max-w-md overflow-hidden rounded-b-none sm:rounded-2xl animate-scale-in">
        <header className="flex items-center justify-between border-b border-white/5 px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
            <Share2 size={16} className="text-accent-400" />
            Share with a friend
          </span>
          <button type="button" onClick={onClose} aria-label="Close" className="icon-btn h-8 w-8">
            <X size={16} />
          </button>
        </header>

        <div className="border-b border-white/5 px-4 py-3">
          {/*
            Narrowed by naming the library kinds rather than excluding the
            picker's: the union also carries listen-along invites, which have
            no subtitle and are never shared through this dialog.
          */}
          <p className="truncate text-sm font-medium text-zinc-100">
            {isLibraryItem(attachment) ? attachment.name : 'Attachment'}
          </p>
          {isLibraryItem(attachment) && attachment.subtitle && (
            <p className="truncate text-xs text-zinc-500">{attachment.subtitle}</p>
          )}
          <input
            type="text"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Add a message (optional)"
            className="mt-3 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-accent-500/50 focus:outline-none"
          />
        </div>

        <div className="max-h-72 overflow-y-auto overscroll-contain p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          {friendsQuery.isLoading ? (
            <p className="px-3 py-8 text-center text-sm text-zinc-500">Loading friends…</p>
          ) : friends.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm leading-relaxed text-zinc-500">
              You have no friends yet. Add someone from the Friends page and you'll be able to share
              with them here.
            </p>
          ) : (
            friends.map((friend) => {
              const done = sentTo.includes(friend.id);
              return (
                <button
                  key={friend.id}
                  type="button"
                  disabled={done || send.isPending}
                  onClick={() => send.mutate(friend.id)}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-white/5 disabled:opacity-60"
                >
                  <Avatar profile={friend} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-zinc-100">
                      {friend.displayName || friend.username}
                    </span>
                    <span className="block truncate text-xs text-zinc-600">@{friend.username}</span>
                  </span>
                  {done ? (
                    <Check size={16} className="text-emerald-400" />
                  ) : send.isPending ? (
                    <Loader2 size={15} className="animate-spin text-zinc-600" />
                  ) : (
                    <Send size={15} className="text-zinc-500" />
                  )}
                </button>
              );
            })
          )}
        </div>

        {send.isError && (
          <p className="border-t border-white/5 px-4 py-2 text-xs text-red-400">
            {send.error instanceof Error ? send.error.message : 'Could not send.'}
          </p>
        )}
      </div>
    </div>
  );
}

/** Button that opens the share sheet for one library item. */
export function ShareButton({
  attachment,
  className = '',
  label = 'Share',
}: {
  attachment: Attachment;
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
        className={className || 'btn-ghost'}
        title="Share with a friend"
      >
        <Share2 size={15} />
        {label}
      </button>
      {open && <ShareDialog attachment={attachment} onClose={() => setOpen(false)} />}
    </>
  );
}
