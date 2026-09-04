import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Download, ListPlus, Play, Shuffle } from 'lucide-react';

import { CoverImage } from '../components/CoverImage';
import { FavoriteButton } from '../components/FavoriteButton';
import { ShareButton } from '../components/ShareDialog';
import { TrackRow } from '../components/TrackRow';
import { ErrorState, TrackListSkeleton } from '../components/states';
import { mediaUrl } from '../lib/api';
import { useAlbum } from '../hooks/useLibrary';
import { usePlayer } from '../context/PlayerContext';
import { formatBytes, formatRuntime, isHiRes, qualityLabel } from '../lib/format';
import type { Track } from '../lib/types';

/** Album detail: hero header + full track list grouped by disc. */
export function AlbumPage() {
  const { id } = useParams<{ id: string }>();
  const query = useAlbum(id);
  const { playTracks, enqueue, toggleShuffle, shuffle } = usePlayer();

  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => query.refetch()} title="Album unavailable" />;
  }

  if (query.isLoading || !query.data) {
    return (
      <div className="space-y-8">
        <div className="flex flex-col gap-6 sm:flex-row">
          <div className="skeleton aspect-square w-full max-w-[240px] rounded-2xl" />
          <div className="flex-1 space-y-3 pt-2">
            <div className="skeleton h-4 w-24 rounded" />
            <div className="skeleton h-9 w-2/3 rounded" />
            <div className="skeleton h-4 w-1/3 rounded" />
          </div>
        </div>
        <TrackListSkeleton />
      </div>
    );
  }

  const { album, tracks } = query.data;
  const totalSize = tracks.reduce((sum, track) => sum + track.size, 0);
  const hiRes = tracks.some(isHiRes);

  // Group by disc so multi-disc releases read correctly.
  const discs = new Map<number, Track[]>();
  for (const track of tracks) {
    const disc = track.discNo ?? 1;
    const list = discs.get(disc);
    if (list) list.push(track);
    else discs.set(disc, [track]);
  }
  const multiDisc = discs.size > 1;

  return (
    <div className="space-y-8">
      <Link
        to={`/artists/${album.artistId}`}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-300"
      >
        <ArrowLeft size={14} />
        {album.artistName}
      </Link>

      {/* ------------------------------ header ---------------------------- */}
      <header className="flex flex-col gap-6 sm:flex-row sm:items-end animate-fade-up">
        <CoverImage
          id={album.id}
          name={album.name}
          hasCover={album.hasCover}
          size={640}
          eager
          rounded="rounded-2xl"
          className="aspect-square w-full max-w-[240px] shadow-lift"
        />

        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="pill pill-accent">Album</span>
            {hiRes && <span className="pill border-amber-400/30 bg-amber-400/10 text-amber-300">Hi-Res</span>}
            {album.lossless && !hiRes && (
              <span className="pill border-emerald-400/30 bg-emerald-400/10 text-emerald-300">Lossless</span>
            )}
            {album.formats.map((format) => (
              <span key={format} className="pill">
                {format}
              </span>
            ))}
          </div>

          <h1 className="text-balance text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl">
            {album.name}
          </h1>

          <p className="text-sm text-zinc-400">
            <Link to={`/artists/${album.artistId}`} className="font-medium text-zinc-200 hover:underline">
              {album.artistName}
            </Link>
            {album.year ? ` · ${album.year}` : ''} · {album.trackCount} tracks ·{' '}
            {formatRuntime(album.duration)} · {formatBytes(totalSize)}
          </p>

          {album.genres.length > 0 && (
            <p className="text-xs text-zinc-600">{album.genres.join(' · ')}</p>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="button" onClick={() => playTracks(tracks, 0)} className="btn-primary">
              <Play size={16} className="fill-current" />
              Play album
            </button>
            <button
              type="button"
              onClick={() => {
                if (!shuffle) toggleShuffle();
                playTracks(tracks, Math.floor(Math.random() * tracks.length));
              }}
              className="btn-ghost"
            >
              <Shuffle size={15} />
              Shuffle
            </button>
            <button type="button" onClick={() => enqueue(tracks, 'end')} className="btn-ghost">
              <ListPlus size={15} />
              Queue
            </button>
            <FavoriteButton kind="album" id={album.id} label={album.name} />
            <ShareButton
              attachment={{
                kind: 'album',
                id: album.id,
                name: album.name,
                subtitle: album.artistName,
              }}
            />
          </div>
        </div>
      </header>

      {/* ---------------------------- track list -------------------------- */}
      <section className="surface p-1.5">
        {[...discs.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([disc, discTracks]) => (
            <div key={disc}>
              {multiDisc && (
                <h2 className="px-3 pb-1 pt-4 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">
                  Disc {disc}
                </h2>
              )}
              <div className="divide-y divide-white/[0.03]">
                {discTracks.map((track) => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    tracks={tracks}
                    index={tracks.indexOf(track)}
                    variant="album"
                  />
                ))}
              </div>
            </div>
          ))}
      </section>

      {/* Per-file details: the collection's technical fingerprint. */}
      <section className="surface overflow-hidden">
        <h2 className="border-b border-white/5 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
          Files
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="text-zinc-600">
              <tr className="border-b border-white/5">
                <th className="px-4 py-2.5 font-medium">Track</th>
                <th className="px-4 py-2.5 font-medium">Format</th>
                <th className="px-4 py-2.5 font-medium">Bitrate</th>
                <th className="px-4 py-2.5 font-medium">Size</th>
                <th className="px-4 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.03] text-zinc-400">
              {tracks.map((track) => (
                <tr key={track.id} className="transition-colors hover:bg-white/[0.02]">
                  <td className="max-w-xs truncate px-4 py-2.5 text-zinc-300">{track.title}</td>
                  <td className="px-4 py-2.5 font-mono">{qualityLabel(track)}</td>
                  <td className="px-4 py-2.5 tabular-nums">
                    {track.bitrate ? `${Math.round(track.bitrate / 1000)} kbps` : '—'}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">{formatBytes(track.size)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <a
                      href={mediaUrl.download(track.id)}
                      download
                      aria-label={`Download ${track.title}`}
                      className="inline-flex items-center gap-1 text-zinc-500 transition-colors hover:text-accent-300"
                    >
                      <Download size={13} />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
