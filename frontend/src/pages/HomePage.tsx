import { Link } from 'react-router-dom';
import { ArrowRight, Disc3, Music2, Sparkles, Users } from 'lucide-react';

import { AlbumCard } from '../components/AlbumCard';
import { ArtistCard } from '../components/ArtistCard';
import { SectionHeader } from '../components/PageHeader';
import { CardGridSkeleton, ErrorState, ScanningState } from '../components/states';
import { useAlbums, useArtists, useRecentAlbums, useStats } from '../hooks/useLibrary';
import { formatBytes, formatNumber, formatRuntime } from '../lib/format';
import { siteName, siteTagline } from '../lib/config';

/** Landing page: hero + library stats, recently added, and top artists. */
export function HomePage() {
  const stats = useStats();
  const recent = useRecentAlbums(12);
  const artists = useArtists({ sort: 'tracks', limit: 12 });
  const albums = useAlbums({ sort: 'random', limit: 12 });

  if (stats.isError) {
    return <ErrorState error={stats.error} onRetry={() => stats.refetch()} title="Can't reach the archive" />;
  }

  const empty = stats.data && stats.data.tracks === 0;

  return (
    <div className="space-y-12">
      {/* ------------------------------ hero ------------------------------ */}
      <section className="relative overflow-hidden rounded-3xl border border-white/5 bg-ink-900/40 px-6 py-10 shadow-card sm:px-10 sm:py-14 animate-fade-up">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-24 -top-32 h-72 w-72 rounded-full bg-accent-500/20 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 right-0 h-72 w-72 rounded-full bg-glow/10 blur-3xl"
        />

        <div className="relative max-w-3xl">
          <span className="pill pill-accent">
            <Sparkles size={12} />
            Private collection
          </span>
          <h1 className="mt-4 text-balance text-4xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-6xl">
            {siteName}
          </h1>
          <p className="mt-3 max-w-xl text-balance text-sm leading-relaxed text-zinc-400 sm:text-base">
            {siteTagline}
          </p>

          <div className="mt-7 flex flex-wrap gap-2.5">
            <Link to="/artists" className="btn-primary">
              <Users size={16} />
              Browse artists
            </Link>
            <Link to="/albums" className="btn-ghost">
              <Disc3 size={16} />
              All albums
            </Link>
            <Link to="/tracks" className="btn-ghost">
              <Music2 size={16} />
              Track search
            </Link>
          </div>

          {stats.data && (
            <dl className="mt-9 grid max-w-2xl grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-4">
              <Stat label="Artists" value={formatNumber(stats.data.artists)} />
              <Stat label="Albums" value={formatNumber(stats.data.albums)} />
              <Stat label="Tracks" value={formatNumber(stats.data.tracks)} />
              <Stat label="On disk" value={formatBytes(stats.data.size)} />
            </dl>
          )}

          {stats.data && stats.data.duration > 0 && (
            <p className="mt-5 text-xs text-zinc-600">
              {formatRuntime(stats.data.duration)} of music ·{' '}
              {stats.data.formats
                .slice(0, 5)
                .map((format) => `${format.ext.toUpperCase()} ${formatNumber(format.count)}`)
                .join(' · ')}
            </p>
          )}
        </div>
      </section>

      {empty ? (
        <ScanningState />
      ) : (
        <>
          <section>
            <SectionHeader
              title="Recently added"
              action={
                <Link
                  to="/albums?sort=recent"
                  className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-widest text-zinc-500 transition-colors hover:text-accent-300"
                >
                  See all <ArrowRight size={13} />
                </Link>
              }
            />
            {recent.isLoading ? (
              <CardGridSkeleton count={6} />
            ) : recent.isError ? (
              <ErrorState error={recent.error} onRetry={() => recent.refetch()} />
            ) : (
              <div className="card-grid">
                {recent.data?.map((album, index) => (
                  <AlbumCard key={album.id} album={album} eager={index < 6} />
                ))}
              </div>
            )}
          </section>

          <section>
            <SectionHeader
              title="Most represented artists"
              action={
                <Link
                  to="/artists?sort=tracks"
                  className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-widest text-zinc-500 transition-colors hover:text-accent-300"
                >
                  See all <ArrowRight size={13} />
                </Link>
              }
            />
            {artists.isLoading ? (
              <CardGridSkeleton count={6} circle />
            ) : artists.isError ? (
              <ErrorState error={artists.error} onRetry={() => artists.refetch()} />
            ) : (
              <div className="card-grid">
                {artists.data?.items.map((artist) => <ArtistCard key={artist.id} artist={artist} />)}
              </div>
            )}
          </section>

          <section>
            <SectionHeader title="From the vault" />
            {albums.isLoading ? (
              <CardGridSkeleton count={6} />
            ) : albums.isError ? (
              <ErrorState error={albums.error} onRetry={() => albums.refetch()} />
            ) : (
              <div className="card-grid">
                {albums.data?.items.map((album) => <AlbumCard key={album.id} album={album} />)}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">{label}</dt>
      <dd className="mt-1 text-2xl font-bold tabular-nums text-zinc-100">{value}</dd>
    </div>
  );
}
