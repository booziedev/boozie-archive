import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, LogOut, MessageSquare, Send } from 'lucide-react';

import { Portal } from './Portal';
import { admin } from '../lib/api';

/**
 * The two per-account controls that are about a person rather than their
 * playback: drop their devices, or put a note on their screen.
 *
 * These live on the Accounts tab rather than beside the playback controls
 * because neither needs the person to be listening to anything — signing out
 * somebody who is asleep is a perfectly ordinary thing to want.
 *
 * Kept to two icon buttons so the row stays a row. The message dialog goes
 * through `Portal` for the reason every overlay in this app does: `.surface`
 * carries a backdrop filter, which makes it the containing block for anything
 * `fixed` inside it.
 */
export function AdminAccountActions({
  userId,
  username,
  isSelf,
  onDone,
}: {
  userId: string;
  username: string;
  isSelf: boolean;
  onDone?: () => void;
}) {
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const signOut = useMutation({
    mutationFn: () => admin.signOutUser(userId),
    onSuccess: (result) => {
      setError(null);
      setNote(
        result.sessions === 0
          ? 'They had no devices signed in.'
          : `Signed out of ${result.sessions} device${result.sessions === 1 ? '' : 's'}.`,
      );
      onDone?.();
    },
    onError: (mutationError: unknown) =>
      setError(mutationError instanceof Error ? mutationError.message : 'That did not work.'),
  });

  const message = useMutation({
    mutationFn: () => admin.noticeUser(userId, text.trim()),
    onSuccess: () => {
      setError(null);
      setNote('Sent — it appears on their screen within a second or two.');
      setText('');
      setComposing(false);
    },
    onError: (mutationError: unknown) =>
      setError(mutationError instanceof Error ? mutationError.message : 'That did not work.'),
  });

  const busy = signOut.isPending || message.isPending;

  return (
    <>
      <button
        type="button"
        onClick={() => setComposing(true)}
        disabled={busy || isSelf}
        title={isSelf ? 'Use a note to yourself for that' : `Send ${username} a message`}
        aria-label={`Send ${username} a message`}
        className="icon-btn h-8 w-8 disabled:opacity-30"
      >
        <MessageSquare size={15} />
      </button>

      <button
        type="button"
        onClick={() => {
          if (window.confirm(`Sign ${username} out of every device?`)) signOut.mutate();
        }}
        disabled={busy || isSelf}
        title={isSelf ? "Use the ordinary sign-out for your own account" : 'Sign out everywhere'}
        aria-label={`Sign ${username} out everywhere`}
        className="icon-btn h-8 w-8 hover:text-amber-400 disabled:opacity-30"
      >
        {signOut.isPending ? <Loader2 size={15} className="animate-spin" /> : <LogOut size={15} />}
      </button>

      {(note || error) && (
        <span
          className={`max-w-[12rem] truncate text-[10px] ${error ? 'text-red-400' : 'text-zinc-500'}`}
        >
          {error || note}
        </span>
      )}

      {composing && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4">
            <button
              type="button"
              aria-label="Close"
              className="absolute inset-0 h-full w-full cursor-default"
              onClick={() => setComposing(false)}
            />
            <div className="surface-dialog relative z-10 w-full max-w-sm p-4">
              <p className="text-sm font-medium text-zinc-100">Message {username}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
                Appears on their screen until they dismiss it.
              </p>
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={280}
                rows={3}
                autoFocus
                placeholder="Easy on the skipping — you're hammering the Pi."
                className="mt-3 w-full resize-none rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-accent-500/50 focus:outline-none"
              />
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="text-[10px] tabular-nums text-zinc-600">{text.length}/280</span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setComposing(false)}
                    className="btn-ghost px-3 py-1.5 text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => message.mutate()}
                    disabled={busy || text.trim().length === 0}
                    className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
                  >
                    {message.isPending ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Send size={13} />
                    )}
                    Send
                  </button>
                </span>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
