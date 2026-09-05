import { useEffect, useLayoutEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Disc3,
  Heart,
  Home,
  LogOut,
  Lightbulb,
  MessageSquare,
  Music2,
  Settings,
  Shield,
  Wrench,
  UserRound,
  Users,
  Loader2,
} from 'lucide-react';

import { Player } from './Player';
import { SearchBar } from './SearchBar';
import { useQuery } from '@tanstack/react-query';

import { AccountMenu } from './AccountMenu';
import { AnnouncementBanner } from './AnnouncementBanner';
import { Avatar } from './Avatar';
import { Logo } from './Logo';
import { social } from '../lib/api';
import { useStats } from '../hooks/useLibrary';
import { useAuth } from '../context/AuthContext';
import { useFavorites } from '../context/FavoritesContext';
import { formatBytes, formatNumber, formatRuntime } from '../lib/format';
import { siteName } from '../lib/config';

const NAV = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/artists', label: 'Artists', icon: Users, end: false },
  { to: '/albums', label: 'Albums', icon: Disc3, end: false },
  { to: '/tracks', label: 'Tracks', icon: Music2, end: false },
  { to: '/favourites', label: 'Favourites', icon: Heart, end: false },
] as const;

/** Social entries carry unread counts, so they live in their own group. */
const SOCIAL_NAV = [
  { to: '/friends', label: 'Friends', icon: UserRound, badge: 'friendRequests' as const },
  { to: '/messages', label: 'Messages', icon: MessageSquare, badge: 'messages' as const },
  { to: '/suggestions', label: 'Suggestions', icon: Lightbulb, badge: null },
] as const;

/** Small count pill shown next to a nav entry. */
function NavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-auto rounded-full bg-accent-500 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white">
      {count > 99 ? '99+' : count}
    </span>
  );
}

/** App shell: sidebar (desktop), top bar, bottom tab bar (mobile) and player. */
export function Layout() {
  const { data: stats } = useStats();
  const { favorites } = useFavorites();
  const { user, isAdmin, info, signOut } = useAuth();
  const location = useLocation();

  // Polled so a new message or friend request shows up without a refresh.
  const badgesQuery = useQuery({
    queryKey: ['social', 'badges'],
    queryFn: social.badges,
    enabled: Boolean(user),
    refetchInterval: 20_000,
  });
  const badges = badgesQuery.data ?? { messages: 0, friendRequests: 0 };

  const profileQuery = useQuery({
    queryKey: ['profile', 'me'],
    queryFn: social.myProfile,
    enabled: Boolean(user),
    staleTime: 5 * 60 * 1000,
  });
  const myProfile = profileQuery.data?.profile ?? null;

  /**
   * The fixed chrome changes height with the viewport: the player bar appears
   * only while something is playing, the tab bar is phone-only, and both grow
   * by the device's safe-area inset. Measuring them and publishing the result
   * as CSS variables lets every page reserve exactly the right space instead of
   * padding for a guessed worst case — which is what left a phone-sized hole
   * under the messenger.
   */
  const headerRef = useRef<HTMLElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = document.documentElement;

    function measure() {
      const top = headerRef.current?.offsetHeight ?? 0;
      const bottom = bottomRef.current?.offsetHeight ?? 0;
      root.style.setProperty('--chrome-top', `${top}px`);
      root.style.setProperty('--chrome-bottom', `${bottom}px`);
    }

    measure();
    const observer = new ResizeObserver(measure);
    if (headerRef.current) observer.observe(headerRef.current);
    if (bottomRef.current) observer.observe(bottomRef.current);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, []);
  const fallbackProfile = {
    id: user?.id ?? '',
    username: user?.username ?? '',
    displayName: null,
    avatarUrl: null,
    accentColor: null,
  };

  // Every navigation starts at the top of the page.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [location.pathname, location.search]);

  const favouriteCount =
    favorites.track.length + favorites.album.length + favorites.artist.length;

  return (
    <div className="min-h-[100dvh]">
      {/* ---------------------------- sidebar ---------------------------- */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-white/5 bg-ink-900/50 backdrop-blur-xl lg:flex">
        <div className="px-6 py-7">
          <NavLink to="/" className="group block">
            <span className="flex items-center gap-2.5">
              <Logo size={36} />
              <span className="text-[15px] font-extrabold tracking-[0.14em] text-zinc-100 transition-colors group-hover:text-white">
                {siteName}
              </span>
            </span>
          </NavLink>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {[...NAV].map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ease-vault ${
                  isActive
                    ? 'bg-white/[0.06] text-white'
                    : 'text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-200'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={`absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-accent-500 transition-opacity duration-200 ${
                      isActive ? 'opacity-100' : 'opacity-0'
                    }`}
                  />
                  <Icon size={18} strokeWidth={2} />
                  {label}
                  {to === '/favourites' && favouriteCount > 0 && (
                    <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[10px] tabular-nums text-zinc-300">
                      {favouriteCount}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}

          {user && (
            <>
              <hr className="!my-3 border-white/5" />
              {SOCIAL_NAV.map(({ to, label, icon: Icon, badge }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ease-vault ${
                      isActive
                        ? 'bg-white/[0.06] text-white'
                        : 'text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-200'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span
                        className={`absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-accent-500 transition-opacity duration-200 ${
                          isActive ? 'opacity-100' : 'opacity-0'
                        }`}
                      />
                      <Icon size={18} strokeWidth={2} />
                      {label}
                      {badge && <NavBadge count={badges[badge]} />}
                    </>
                  )}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        <div className="space-y-3 px-6 pb-6">
          {user && (
            <div className="flex items-center gap-2 border-b border-white/5 pb-3">
              <NavLink to="/profile" className="flex min-w-0 flex-1 items-center gap-2">
                <Avatar profile={myProfile ?? fallbackProfile} size={28} ring />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-zinc-300">
                    {myProfile?.displayName || user.username}
                  </span>
                  {isAdmin && (
                    <span className="block text-[10px] uppercase tracking-wider text-accent-400">admin</span>
                  )}
                </span>
              </NavLink>
              <button
                type="button"
                onClick={() => void signOut()}
                title="Sign out"
                aria-label="Sign out"
                className="icon-btn h-8 w-8"
              >
                <LogOut size={15} />
              </button>
            </div>
          )}

          {isAdmin && (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                `flex items-center gap-2 text-xs transition-colors ${
                  isActive ? 'text-accent-300' : 'text-zinc-600 hover:text-zinc-300'
                }`
              }
            >
              <Shield size={14} />
              Admin panel
            </NavLink>
          )}

          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex items-center gap-2 text-xs transition-colors ${
                isActive ? 'text-zinc-200' : 'text-zinc-600 hover:text-zinc-300'
              }`
            }
          >
            <Settings size={14} />
            Settings
          </NavLink>

          {stats && (
            <div className="space-y-1 border-t border-white/5 pt-4 text-[11px] leading-relaxed text-zinc-600">
              <p>
                <span className="text-zinc-400">{formatNumber(stats.tracks)}</span> tracks ·{' '}
                <span className="text-zinc-400">{formatNumber(stats.albums)}</span> albums
              </p>
              <p>
                {formatBytes(stats.size)} · {formatRuntime(stats.duration)}
              </p>
              {stats.scanning && (
                <p className="flex items-center gap-1.5 pt-1 text-accent-400">
                  <Loader2 size={11} className="animate-spin" />
                  Indexing…
                </p>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* ---------------------------- main ------------------------------- */}
      <div className="lg:pl-64">
        <header
          ref={headerRef}
          className="sticky top-0 z-30 border-b border-white/5 bg-ink-950/70 backdrop-blur-2xl"
        >
          <div className="mx-auto flex max-w-[1800px] items-center gap-3 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6 lg:py-3.5">
            <NavLink to="/" aria-label="Home" className="shrink-0 lg:hidden">
              <Logo size={32} />
            </NavLink>
            <SearchBar className="min-w-0 max-w-xl flex-1" />

            <div className="lg:hidden">
              <AccountMenu profile={myProfile} badges={badges} />
            </div>
          </div>
        </header>

        {/* Bottom padding tracks the measured chrome, with a floor for first paint. */}
        <AnnouncementBanner />

        {/* Admins keep browsing during maintenance; this is the reminder. */}
        {isAdmin && info?.maintenance?.enabled && (
          <div className="border-b border-amber-400/20 bg-amber-400/10">
            <div className="mx-auto flex max-w-[1800px] items-center gap-2 px-4 py-2 text-xs text-amber-200 sm:px-6">
              <Wrench size={13} className="shrink-0" />
              Maintenance mode is on — members can't reach the archive.
              <NavLink to="/admin" className="ml-auto shrink-0 font-semibold underline">
                Manage
              </NavLink>
            </div>
          </div>
        )}

        <main
          className="mx-auto max-w-[1800px] px-4 pt-6 sm:px-6 lg:pt-8"
          style={{ paddingBottom: 'calc(var(--chrome-bottom, 8rem) + 2rem)' }}
        >
          <Outlet />
        </main>
      </div>

      {/* ---------------- fixed bottom chrome (measured) ------------------- */}
      <div ref={bottomRef} className="pointer-events-none fixed inset-x-0 bottom-0 z-40">
        <div className="pointer-events-auto">
          <Player />
        </div>

        <nav className="pointer-events-auto border-t border-white/5 bg-ink-900/90 backdrop-blur-2xl lg:hidden">
        <div className="flex items-stretch justify-around pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-1.5">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-[10px] font-medium transition-colors ${
                  isActive ? 'text-accent-300' : 'text-zinc-500'
                }`
              }
            >
              <Icon size={19} strokeWidth={2} />
              <span className="truncate">{label}</span>
            </NavLink>
            ))}
          </div>
        </nav>
      </div>
    </div>
  );
}
