import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Route, Routes } from 'react-router-dom';

import { Layout } from './components/Layout';
import { AlbumPage } from './pages/AlbumPage';
import { AlbumsPage } from './pages/AlbumsPage';
import { ArtistPage } from './pages/ArtistPage';
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

export function App() {
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
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
