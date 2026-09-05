import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Disc3,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Music2,
  Radio,
  Send,
  Trash2,
  User,
} from 'lucide-react';

import { Avatar } from '../components/Avatar';
import { CoverImage } from '../components/CoverImage';
import { ListeningNow } from '../components/ListeningNow';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState } from '../components/states';
import { StickerPicker } from '../components/StickerPicker';
import { presence, social } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { usePresence } from '../context/PresenceContext';
import type { Attachment, Message, ThreadSummary } from '../lib/types';

/** "14:32" for today, "Mon 14:32" this week, else a date. */
function messageTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const withinWeek = now.getTime() - date.getTime() < 7 * 86400_000;
  return date.toLocaleString(undefined, {
    weekday: withinWeek ? 'short' : undefined,
    day: withinWeek ? undefined : '2-digit',
    month: withinWeek ? undefined : 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * A listen-along invite.
 *
 * The button checks the session is still live when it is pressed, so an old
 * invite scrolled back to says so instead of failing silently.
 */
function PartyInvite({
  partyId,
  host,
  mine,
  friend,
}: {
  partyId: string;
  host: string;
  /** True on the sender's own screen — the same card, read from both ends. */
  mine: boolean;
  friend: string;
}) {
  const { party, joinParty, leaveParty } = usePresence();
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const inThis = party?.id === partyId && party.live;
  const hosting = Boolean(inThis && party?.isHost);

  async function join() {
    setError(null);
    setJoining(true);
    try {
      await joinParty(partyId);
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : 'Could not join.');
    } finally {
      setJoining(false);
    }
  }

  const line = hosting
    ? `You're hosting — ${friend} can join from here.`
    : inThis
      ? `You're listening along with ${host}.`
      : mine
        ? `You invited ${friend} to listen along.`
        : `${host} wants to listen along with you.`;

  return (
    <div className="mt-1.5 rounded-xl border border-accent-500/30 bg-accent-500/10 p-3">
      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-accent-300">
        <Radio size={11} />
        Listen together
      </p>
      <p className="mt-1 text-sm text-zinc-200">{line}</p>

      {inThis ? (
        <button
          type="button"
          onClick={() => void leaveParty()}
          className="btn-ghost mt-2 px-3 py-1.5 text-xs"
        >
          {hosting ? 'End session' : 'Leave session'}
        </button>
      ) : mine ? (
        // Your own invite to a session you are no longer in: nothing to join.
        <p className="mt-1 text-xs text-white/50">That session has ended.</p>
      ) : (
        <button
          type="button"
          onClick={() => void join()}
          disabled={joining}
          className="btn-primary mt-2 px-3 py-1.5 text-xs"
        >
          {joining ? <Loader2 size={13} className="animate-spin" /> : <Radio size={13} />}
          Join
        </button>
      )}
      {error && <p className="mt-1.5 text-xs text-red-300">{error}</p>}
    </div>
  );
}

/** Renders a shared album/artist/track, a GIF or an emoji inside a bubble. */
function AttachmentView({
  attachment,
  mine,
  friend,
}: {
  attachment: Attachment;
  mine: boolean;
  friend: string;
}) {
  if (attachment.kind === 'party') {
    return (
      <PartyInvite
        partyId={attachment.id}
        host={attachment.name || 'A friend'}
        mine={mine}
        friend={friend}
      />
    );
  }

  if (attachment.kind === 'gif') {
    return (
      <img
        src={attachment.url}
        alt={attachment.title ?? 'GIF'}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="mt-1 max-h-64 rounded-xl"
      />
    );
  }

  if (attachment.kind === 'emoji') {
    return (
      <img
        src={attachment.url}
        alt={attachment.name}
        title={`:${attachment.name}:`}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="mt-1 h-12 w-12 object-contain"
      />
    );
  }

  const to =
    attachment.kind === 'album'
      ? `/albums/${attachment.id}`
      : attachment.kind === 'artist'
        ? `/artists/${attachment.id}`
        : `/tracks?q=${encodeURIComponent(attachment.name)}`;

  const Icon = attachment.kind === 'artist' ? User : attachment.kind === 'track' ? Music2 : Disc3;

  return (
    <Link
      to={to}
      className="mt-1.5 flex items-center gap-3 rounded-xl border border-white/10 bg-black/25 p-2 transition-colors hover:border-white/20 hover:bg-black/40"
    >
      {attachment.kind === 'artist' ? (
        <CoverImage
          id={attachment.id}
          name={attachment.name}
          size={128}
          rounded="rounded-full"
          className="h-12 w-12"
        />
      ) : (
        <CoverImage
          id={attachment.id}
          name={attachment.name}
          size={128}
          rounded="rounded-lg"
          className="h-12 w-12"
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-accent-300">
          <Icon size={10} />
          {attachment.kind}
        </span>
        <span className="block truncate text-sm font-medium text-zinc-100">{attachment.name}</span>
        {attachment.subtitle && (
          <span className="block truncate text-xs text-zinc-500">{attachment.subtitle}</span>
        )}
      </span>
    </Link>
  );
}

/** The conversation with one friend. */
function Conversation({ thread }: { thread: ThreadSummary }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const messagesQuery = useQuery({
    queryKey: ['dm', thread.id],
    queryFn: () => social.messages(thread.id),
    // Polling keeps this simple and reliable on iOS, where a websocket would be
    // dropped every time the app is backgrounded.
    refetchInterval: 4000,
    refetchIntervalInBackground: false,
  });

  const messages = messagesQuery.data?.messages ?? [];
  const lastId = messages[messages.length - 1]?.id;

  // Follow new messages, and clear the unread badge while the thread is open.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
    if (!lastId) return;
    social
      .markRead(thread.id)
      .then(() => queryClient.invalidateQueries({ queryKey: ['social', 'badges'] }))
      .catch(() => undefined);
  }, [lastId, queryClient, thread.id]);

  const send = useMutation({
    mutationFn: (input: { body?: string; attachment?: Attachment }) =>
      social.sendMessage(thread.id, input),
    onMutate: () => setError(null),
    onSuccess: async () => {
      setDraft('');
      await queryClient.invalidateQueries({ queryKey: ['dm', thread.id] });
      await queryClient.invalidateQueries({ queryKey: ['dm', 'threads'] });
    },
    onError: (sendError) =>
      setError(sendError instanceof Error ? sendError.message : 'Could not send.'),
  });

  const remove = useMutation({
    mutationFn: social.deleteMessage,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dm', thread.id] }),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || send.isPending) return;
    send.mutate({ body });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-white/5 px-3 py-2.5">
        <Link to="/messages" aria-label="Back to conversations" className="icon-btn h-9 w-9 lg:hidden">
          <ArrowLeft size={18} />
        </Link>
        <Link to={`/u/${thread.friend.username}`} className="flex min-w-0 flex-1 items-center gap-3">
          <Avatar profile={thread.friend} size={38} ring />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-zinc-100">
              {thread.friend.displayName || thread.friend.username}
            </span>
            {/* Their current track sits where the handle would, and falls back
                to the handle when there is nothing to show. */}
            {thread.friend.listeningNow ? (
              <ListeningNow now={thread.friend.listeningNow} compact />
            ) : (
              <span className="block truncate text-xs text-zinc-600">@{thread.friend.username}</span>
            )}
          </span>
        </Link>
        <InviteToListen friendId={thread.friend.id} threadId={thread.id} />
      </header>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 py-4">
        {messagesQuery.isLoading ? (
          <p className="py-8 text-center text-sm text-zinc-500">Loading messages…</p>
        ) : messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-600">
            No messages yet — say hello, or share something from the archive.
          </p>
        ) : (
          messages.map((message: Message) => {
            const mine = message.senderId === user?.id;
            return (
              <div key={message.id} className={`group flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`flex max-w-[85%] items-end gap-1.5 ${mine ? 'flex-row-reverse' : ''}`}>
                  <div
                    className={`rounded-2xl px-3 py-2 ${
                      mine
                        ? 'bg-accent-600/90 text-white'
                        : 'border border-white/5 bg-white/[0.06] text-zinc-100'
                    }`}
                  >
                    {message.deleted ? (
                      <p className="text-sm italic text-white/50">Message deleted</p>
                    ) : (
                      <>
                        {message.body && (
                          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                            {message.body}
                          </p>
                        )}
                        {message.attachment && (
                          <AttachmentView
                            attachment={message.attachment}
                            mine={mine}
                            friend={thread.friend.displayName || thread.friend.username}
                          />
                        )}
                      </>
                    )}
                    <span
                      className={`mt-1 block text-[10px] tabular-nums ${mine ? 'text-white/50' : 'text-zinc-600'}`}
                    >
                      {messageTime(message.createdAt)}
                    </span>
                  </div>

                  {mine && !message.deleted && (
                    <button
                      type="button"
                      onClick={() => remove.mutate(message.id)}
                      aria-label="Delete message"
                      // Hover doesn't exist on a phone, so the control is always
                      // shown there and only fades in on pointer devices.
                      className="icon-btn h-7 w-7 transition-opacity group-hover:opacity-100 sm:opacity-0"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {error && <p className="px-4 pb-1 text-xs text-red-400">{error}</p>}

      <form
        onSubmit={submit}
        className="relative flex items-center gap-2 border-t border-white/5 px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]"
      >
        {pickerOpen && (
          <StickerPicker
            onClose={() => setPickerOpen(false)}
            onPick={(attachment) => {
              setPickerOpen(false);
              send.mutate({ attachment });
            }}
          />
        )}

        <button
          type="button"
          onClick={() => setPickerOpen((open) => !open)}
          aria-label="Add a GIF or emoji"
          className={`icon-btn h-10 w-10 ${pickerOpen ? 'text-accent-400' : ''}`}
        >
          <ImageIcon size={19} />
        </button>

        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={`Message ${thread.friend.displayName || thread.friend.username}…`}
          aria-label="Message"
          enterKeyHint="send"
          className="min-w-0 flex-1 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-accent-500/50 focus:outline-none"
        />

        <button
          type="submit"
          disabled={!draft.trim() || send.isPending}
          aria-label="Send"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-500 text-white transition-transform hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100"
        >
          {send.isPending ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
        </button>
      </form>
    </div>
  );
}

/** Two-pane messenger: thread list on the left, conversation on the right. */
export function MessagesPage() {
  const { friendId } = useParams<{ friendId?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const threadsQuery = useQuery({
    queryKey: ['dm', 'threads'],
    queryFn: social.threads,
    // Each thread carries the other person's current track, so this doubles as
    // the poll that keeps their status moving.
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });

  const threads = threadsQuery.data?.threads ?? [];
  const active = friendId ? threads.find((thread) => thread.friend.id === friendId) : undefined;

  /**
   * Opening a conversation with someone you've never messaged creates the
   * thread on demand, so /messages/:friendId always works from a friend row.
   */
  useEffect(() => {
    if (!friendId || active || threadsQuery.isLoading) return;
    let cancelled = false;
    social
      .openThread(friendId)
      .then(async () => {
        if (cancelled) return;
        await queryClient.invalidateQueries({ queryKey: ['dm', 'threads'] });
      })
      .catch(() => {
        if (!cancelled) navigate('/messages', { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [active, friendId, navigate, queryClient, threadsQuery.isLoading]);

  if (threadsQuery.isError) {
    return <ErrorState error={threadsQuery.error} onRetry={() => threadsQuery.refetch()} />;
  }

  return (
    <div>
      <div className={active ? 'hidden lg:block' : ''}>
        <PageHeader title="Messages" subtitle="Private conversations with your friends." />
      </div>
      {/* Desktop keeps the page header above the panel, so it needs the shorter box. */}
      <style>{`@media (min-width: 1024px) { .dm-panel { height: calc(100dvh - var(--chrome-top, 4rem) - var(--chrome-bottom, 8rem) - 11rem) !important; } }`}</style>

      {/*
        Fills the space between the header and the fixed chrome, both measured
        by the layout — so the messenger uses the whole screen on a phone
        instead of stopping short above the tab bar.
      */}
      <div
        className="dm-panel surface grid min-h-[22rem] grid-cols-1 overflow-hidden lg:grid-cols-[20rem_1fr]"
        style={{
          height: active
            ? 'calc(100dvh - var(--chrome-top, 4rem) - var(--chrome-bottom, 8rem) - 3rem)'
            : 'calc(100dvh - var(--chrome-top, 4rem) - var(--chrome-bottom, 8rem) - 9rem)',
        }}
      >
        {/* Thread list — hidden on phones while a conversation is open. */}
        <aside
          className={`min-h-0 overflow-y-auto border-white/5 lg:border-r ${active ? 'hidden lg:block' : 'block'}`}
        >
          {threadsQuery.isLoading ? (
            <p className="p-6 text-sm text-zinc-500">Loading…</p>
          ) : threads.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<MessageSquare size={22} />}
                title="No conversations"
                description="Add a friend, then start a chat from their row on the Friends page."
              />
            </div>
          ) : (
            <ul className="p-1.5">
              {threads.map((thread) => (
                <li key={thread.id}>
                  <Link
                    to={`/messages/${thread.friend.id}`}
                    className={`flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors ${
                      active?.id === thread.id ? 'bg-white/[0.07]' : 'hover:bg-white/[0.03]'
                    }`}
                  >
                    <Avatar profile={thread.friend} size={40} ring />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-zinc-100">
                          {thread.friend.displayName || thread.friend.username}
                        </span>
                        {thread.unread > 0 && (
                          <span className="shrink-0 rounded-full bg-accent-500 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white">
                            {thread.unread}
                          </span>
                        )}
                      </span>
                      {thread.friend.listeningNow ? (
                        <ListeningNow now={thread.friend.listeningNow} compact />
                      ) : (
                        <span className="block truncate text-xs text-zinc-600">
                          {thread.lastMessagePreview ?? 'No messages yet'}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className={`min-h-0 ${active ? 'block' : 'hidden lg:block'}`}>
          {active ? (
            <Conversation thread={active} />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center">
              <p className="max-w-xs text-sm leading-relaxed text-zinc-600">
                Pick a conversation, or share an album with a friend to start one.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * "Listen together" in the conversation header.
 *
 * Pressing it starts a session if there isn't one and drops the invite into
 * this thread, so the whole thing is one tap from the chat you are already in.
 */
function InviteToListen({ friendId, threadId }: { friendId: string; threadId: string }) {
  const queryClient = useQueryClient();
  const { party, isFollowing, startParty } = usePresence();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!failure) return;
    const timer = window.setTimeout(() => setFailure(null), 4000);
    return () => window.clearTimeout(timer);
  }, [failure]);

  // While following someone, your player is theirs to drive — you cannot host.
  if (isFollowing) return null;

  async function invite() {
    setFailure(null);
    setBusy(true);
    try {
      const hosting = party?.isHost && party.live ? party : await startParty();
      if (!hosting) throw new Error('Could not start a listening session.');
      await presence.invite(hosting.id, friendId);
      await queryClient.invalidateQueries({ queryKey: ['dm', threadId] });
      await queryClient.invalidateQueries({ queryKey: ['dm', 'threads'] });
    } catch (inviteError) {
      setFailure(inviteError instanceof Error ? inviteError.message : 'Could not send the invite.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void invite()}
      disabled={busy}
      title={failure ?? 'Invite them to listen along'}
      aria-label="Invite them to listen along"
      className={`icon-btn h-9 w-9 shrink-0 ${failure ? 'text-red-400' : ''}`}
    >
      {busy ? <Loader2 size={17} className="animate-spin" /> : <Radio size={17} />}
    </button>
  );
}
