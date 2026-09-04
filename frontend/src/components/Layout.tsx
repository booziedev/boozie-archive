import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Disc3,
  Heart,
  Home,
  LogOut,
  Music2,
  Settings,
  Shield,
  Users,
  Loader2,
} from 'lucide-react';

import { Player } from './Player';
import { SearchBar } from './SearchBar';
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

/** App shell: sidebar (desktop), top bar, bottom tab bar (mobile) and player. */
export function Layout() {
  const { data: stats } = useStats();
  const { favorites } = useFavorites();
  const { user, isAdmin, signOut } = useAuth();
  const location = useLocation();

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
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent-500 to-glow shadow-glow">
                <Disc3 size={19} className="text-white" />
              </span>
              <span className="text-[15px] font-extrabold tracking-[0.14em] text-zinc-100 transition-colors group-hover:text-white">
                {siteName}
              </span>
            </span>
          </NavLink>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {NAV.map(({ to, label, icon: Icon, end }) => (
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
        </nav>

        <div className="space-y-3 px-6 pb-6">
          {user && (
            <div className="flex items-center gap-2 border-b border-white/5 pb-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-500/20 text-[11px] font-bold uppercase text-accent-200">
                {user.username.slice(0, 2)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-zinc-300">{user.username}</span>
                {isAdmin && (
                  <span className="block text-[10px] uppercase tracking-wider text-accent-400">admin</span>
                )}
              </span>
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
        <header className="sticky top-0 z-30 border-b border-white/5 bg-ink-950/70 backdrop-blur-2xl">
          <div className="mx-auto flex max-w-[1800px] items-center gap-3 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6 lg:py-3.5">
            <NavLink to="/" className="flex items-center gap-2 lg:hidden">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent-500 to-glow">
                <Disc3 size={17} className="text-white" />
              </span>
            </NavLink>
            <SearchBar className="max-w-xl flex-1" />

            {user && (
              <div className="flex items-center gap-0.5 lg:hidden">
                {isAdmin && (
                  <NavLink
                    to="/admin"
                    aria-label="Admin panel"
                    className={({ isActive }) => `icon-btn h-9 w-9 ${isActive ? 'text-accent-300' : ''}`}
                  >
                    <Shield size={18} />
                  </NavLink>
                )}
                <button
                  type="button"
                  onClick={() => void signOut()}
                  aria-label="Sign out"
                  className="icon-btn h-9 w-9"
                >
                  <LogOut size={18} />
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="mx-auto max-w-[1800px] px-4 pb-52 pt-6 sm:px-6 lg:pb-36 lg:pt-8">
          <Outlet />
        </main>
      </div>

      {/* ------------------------ mobile tab bar -------------------------- */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/5 bg-ink-900/90 backdrop-blur-2xl lg:hidden">
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

      <Player />
    </div>
  );
}
