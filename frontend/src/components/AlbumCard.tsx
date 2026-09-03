import { Link } from 'react-router-dom';
import { Play } from 'lucide-react';

import { CoverImage } from './CoverImage';
import { FavoriteButton } from './FavoriteButton';
import { api } from '../lib/api';
import { usePlayer } from '../context/PlayerContext';
import type { Album } from '../lib/types';

interface AlbumCardProps {
  album: Album;
  /** Renders the artist name under the title (hidden on artist pages). */
  showArtist?: boolean;
  eager?: boolean;
}

/** Grid tile for an album: cover, hover play overlay, title and metadata. */
export function AlbumCard({ album, showArtist = true, eager = false }: AlbumCardProps) {
  const { playTracks } = usePlayer();

  /**
   * Fetches the album's tracks and starts playback. The request happens after
   * the click, so the button shows no loading state — album payloads are small
   * and served from the server's memory index.
   */
  async function playAlbum(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    try {
      const detail = await api.album(album.id);
      playTracks(detail.tracks, 0);
    } catch {
      // Failures surface through the player's own error state.
    }
  }

  return (
    <Link
      to={`/albums/${album.id}`}
      className="group relative block rounded-2xl outline-none transition-transform duration-300 ease-vault hover:-translate-y-1 focus-visible:-translate-y-1"
    >
      <div className="relative">
        <CoverImage
          id={album.id}
          name={album.name}
          hasCover={album.hasCover}
          size={320}
          eager={eager}
          className="aspect-square w-full shadow-card transition-shadow duration-300 ease-vault group-hover:shadow-lift"
          rounded="rounded-xl"
        />

        {/* Hover / focus overlay with the play button. */}
        <div className="pointer-events-none absolute inset-0 flex items-end justify-between gap-2 rounded-xl bg-gradient-to-t from-black/75 via-black/10 to-transparent p-2.5 opacity-0 transition-opacity duration-300 ease-vault group-hover:opacity-100 group-focus-visible:opacity-100">
          <span className="pointer-events-auto">
            <FavoriteButton
              kind="album"
              id={album.id}
              label={album.name}
              className="h-9 w-9 bg-black/40 backdrop-blur"
              size={16}
            />
          </span>
          <button
            type="button"
            onClick={playAlbum}
            aria-label={`Play ${album.name}`}
            className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-accent-500 text-white shadow-glow transition-transform duration-200 ease-vault hover:scale-105 active:scale-95"
          >
            <Play size={18} className="ml-0.5 fill-current" />
          </button>
        </div>

        {album.lossless && (
          <span className="pointer-events-none absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300 backdrop-blur">
            Lossless
          </span>
        )}
      </div>

      <div className="mt-3 space-y-0.5 px-0.5">
        <h3 className="truncate text-sm font-semibold text-zinc-100 transition-colors group-hover:text-white">
          {album.name}
        </h3>
        <p className="truncate text-xs text-zinc-500">
          {showArtist ? album.artistName : `${album.trackCount} tracks`}
          {showArtist && album.year ? ` · ${album.year}` : ''}
        </p>
      </div>
    </Link>
  );
}
