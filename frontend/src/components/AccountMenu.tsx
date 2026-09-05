import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Lightbulb, LogOut, MessageSquare, Settings, Shield, UserRound } from 'lucide-react';

import { Avatar } from './Avatar';
import { useAuth } from '../context/AuthContext';
import type { PublicProfile } from '../lib/types';

interface AccountMenuProps {
  profile: Pick<PublicProfile, 'id' | 'username' | 'displayName' | 'avatarUrl' | 'accentColor'> | null;
  badges: { messages: number; friendRequests: number };
}

/**
 * The account menu behind the header avatar.
 *
 * On a phone there is no sidebar, so this is the only route to Profile,
 * Settings, Friends, Messages and signing out — the bottom tab bar is reserved
 * for browsing the library and can't grow past five items at 320px.
 */
export function AccountMenu({ profile, badges }: AccountMenuProps) {
  const { user, isAdmin, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) return null;

  const identity = profile ?? {
    id: user.id,
    username: user.username,
    displayName: null,
    avatarUrl: null,
    accentColor: null,
  };

  const totalBadges = badges.messages + badges.friendRequests;

  const items = [
    { to: '/profile', label: 'Your profile', icon: UserRound, badge: 0 },
    { to: '/friends', label: 'Friends', icon: UserRound, badge: badges.friendRequests },
    { to: '/messages', label: 'Messages', icon: MessageSquare, badge: badges.messages },
    { to: '/suggestions', label: 'Suggestions', icon: Lightbulb, badge: 0 },
    ...(isAdmin ? [{ to: '/admin', label: 'Admin panel', icon: Shield, badge: 0 }] : []),
    { to: '/settings', label: 'Settings', icon: Settings, badge: 0 },
  ];

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Account menu"
        aria-expanded={open}
        aria-haspopup="menu"
        className="relative flex h-10 w-10 items-center justify-center rounded-full transition-transform active:scale-95"
      >
        <Avatar profile={identity} size={32} ring />
        {totalBadges > 0 && !open && (
          <span className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full bg-accent-500 ring-2 ring-ink-950" />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-white/10 bg-ink-900/[0.98] shadow-2xl backdrop-blur-2xl animate-scale-in"
        >
          <div className="flex items-center gap-3 border-b border-white/5 px-3 py-3">
            <Avatar profile={identity} size={38} ring />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-zinc-100">
                {identity.displayName || identity.username}
              </span>
              <span className="block truncate text-xs text-zinc-500">
                {isAdmin ? 'Admin' : `@${identity.username}`}
              </span>
            </span>
          </div>

          <nav className="p-1.5">
            {items.map(({ to, label, icon: Icon, badge }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-sm transition-colors ${
                    isActive ? 'bg-white/10 text-white' : 'text-zinc-300 hover:bg-white/5'
                  }`
                }
              >
                <Icon size={17} className="shrink-0 text-zinc-500" />
                <span className="flex-1 truncate">{label}</span>
                {badge > 0 && (
                  <span className="rounded-full bg-accent-500 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white">
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="border-t border-white/5 p-1.5">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                void signOut();
              }}
              className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-sm text-zinc-300 transition-colors hover:bg-white/5 hover:text-red-300"
            >
              <LogOut size={17} className="shrink-0 text-zinc-500" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
