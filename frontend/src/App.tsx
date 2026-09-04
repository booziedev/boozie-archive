import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Disc3 } from 'lucide-react';

import { Layout } from './components/Layout';
import { useAuth } from './context/AuthContext';
import { AdminPage } from './pages/AdminPage';
import { AlbumPage } from './pages/AlbumPage';
import { AlbumsPage } from './pages/AlbumsPage';
import { ArtistPage } from './pages/ArtistPage';
import { AuthPage } from './pages/AuthPage';
import { ArtistsPage } from './pages/ArtistsPage';
import { FavouritesPage } from './pages/FavouritesPage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { SearchPage } from './pages/SearchPage';
import { SettingsPage } from './pages/SettingsPage';
import { TracksPage } from './pages/TracksPage';

/**
 * Catches render errors so a single bad record can never blank the whole app —
 * on a personal archive the data is whatever the tags happen to contain.
 */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info);
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 p-6 text-center">
          <h1 className="text-xl font-bold text-zinc-100">The interface hit an error</h1>
          <p className="max-w-md text-sm text-zinc-500">{this.state.error.message}</p>
          <button type="button" onClick={() => window.location.reload()} className="btn-primary">
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Blocks a route for non-admins rather than 404-ing it. */
function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin, isLoading } = useAuth();
  if (isLoading) return null;
  if (!isAdmin) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
        <h1 className="text-xl font-bold text-zinc-200">Admins only</h1>
        <p className="max-w-sm text-sm text-zinc-500">
          This page manages invite codes and accounts. Ask an admin if you need access.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

export function App() {
  const { needsAuth, isLoading } = useAuth();

  // Wait for the session check before deciding what to render, so a signed-in
  // visitor never sees the login screen flash on a reload.
  if (isLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center">
        <Disc3 size={28} className="animate-spin text-accent-500" style={{ animationDuration: '2.4s' }} />
      </div>
    );
  }

  // Signed out on a private archive: the only thing reachable is the gate.
  if (needsAuth) {
    return (
      <ErrorBoundary>
        <Routes>
          <Route path="/invite/:code" element={<AuthPage />} />
          <Route path="*" element={<AuthPage />} />
        </Routes>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/artists" element={<ArtistsPage />} />
          <Route path="/artists/:id" element={<ArtistPage />} />
          <Route path="/albums" element={<AlbumsPage />} />
          <Route path="/albums/:id" element={<AlbumPage />} />
          <Route path="/tracks" element={<TracksPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/favourites" element={<FavouritesPage />} />
          {/* Kept so US spelling links don't 404. */}
          <Route path="/favorites" element={<FavouritesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route
            path="/admin"
            element={
              <RequireAdmin>
                <AdminPage />
              </RequireAdmin>
            }
          />
          {/* An invite link opened while already signed in just goes home. */}
          <Route path="/invite/:code" element={<HomePage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
