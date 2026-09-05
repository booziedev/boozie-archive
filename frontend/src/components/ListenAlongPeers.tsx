import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { Avatar } from './Avatar';
import { usePresence } from '../context/PresenceContext';

/**
 * Who is listening along, as a row of overlapping profile pictures.
 *
 * This sits in the player rather than in a banner of its own: a session is a
 * property of what is playing, so it belongs next to it. Hovering a picture
 * names the person; opening the stack lists them and offers the way out.
 */
export function ListenAlongPeers({ className = '' }: { className?: string }) {
  const { party, isFollowing, isHosting, outOfSync, leaveParty, resync } = usePresence();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape, the way any small popover should.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // A session with nobody else in it is just you playing music.
  if (!party?.live || party.listeners.length < 2) return null;

  const host = party.listeners.find((listener) => listener.id === party.hostId);
  const others = party.listeners.filter((listener) => listener.id !== party.hostId);
  // The host is shown first: they are the one everyone else is following.
  const ordered = host ? [host, ...others] : others;
  const shown = ordered.slice(0, 4);
  const overflow = ordered.length - shown.length;

  const label = isHosting
    ? `${others.length} ${others.length === 1 ? 'person is' : 'people are'} listening along`
    : `Listening along with ${party.hostDisplayName || party.hostUsername}`;

  return (
    <div ref={wrapperRef} className={`relative shrink-0 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={label}
        title={label}
        className="flex items-center rounded-full p-0.5 outline-none transition-colors hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-accent-400"
      >
        {shown.map((listener, index) => (
          <span
            key={listener.id}
            className={`relative rounded-full ring-2 ring-ink-900 ${index > 0 ? '-ml-2' : ''}`}
            style={{ zIndex: shown.length - index }}
          >
            {/*
              Avatar carries its own `title`, and the innermost one wins: the
              pointer over a picture names that person, elsewhere on the stack it
              names the session.
            */}
            <Avatar profile={{ ...listener, accentColor: null }} size={26} />
            {listener.id === party.hostId && (
              // A dot marks the host, so the row reads as "them, plus these".
              <span
                aria-hidden
                className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-accent-400 ring-2 ring-ink-900"
              />
            )}
          </span>
        ))}
        {overflow > 0 && (
          <span className="-ml-2 flex h-[26px] min-w-[26px] items-center justify-center rounded-full bg-white/10 px-1 text-[10px] font-semibold text-zinc-300 ring-2 ring-ink-900">
            +{overflow}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full right-0 z-50 mb-2 w-56 rounded-xl border border-white/10 bg-ink-850 p-2 shadow-lift">
          <p className="px-1.5 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            {isHosting ? 'Listening along' : `Following ${party.hostDisplayName || party.hostUsername}`}
          </p>
          <ul className="space-y-0.5">
            {ordered.map((listener) => (
              <li key={listener.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1">
                <Avatar profile={{ ...listener, accentColor: null }} size={22} />
                <span className="min-w-0 flex-1 truncate text-xs text-zinc-200">
                  {listener.displayName || listener.username}
                </span>
                {listener.id === party.hostId && (
                  <span className="shrink-0 text-[10px] uppercase tracking-wider text-accent-400">
                    host
                  </span>
                )}
              </li>
            ))}
          </ul>

          <div className="mt-1.5 flex gap-1.5 border-t border-white/5 pt-1.5">
            {isFollowing && outOfSync && (
              <button
                type="button"
                onClick={() => {
                  resync();
                  setOpen(false);
                }}
                className="btn-ghost flex-1 justify-center px-2 py-1 text-xs"
              >
                <RefreshCw size={12} />
                Resync
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                void leaveParty();
                setOpen(false);
              }}
              className="btn-ghost flex-1 justify-center px-2 py-1 text-xs"
            >
              {isHosting ? 'End session' : 'Leave'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
