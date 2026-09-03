import { Link } from 'react-router-dom';

import { CoverImage } from './CoverImage';
import { FavoriteButton } from './FavoriteButton';
import { formatNumber } from '../lib/format';
import type { Artist } from '../lib/types';

/** Grid tile for an artist — circular artwork, name and library counts. */
export function ArtistCard({ artist, eager = false }: { artist: Artist; eager?: boolean }) {
  return (
    <Link
      to={`/artists/${artist.id}`}
      className="group relative block rounded-2xl text-center outline-none transition-transform duration-300 ease-vault hover:-translate-y-1 focus-visible:-translate-y-1"
    >
      <div className="relative">
        <CoverImage
          id={artist.id}
          name={artist.name}
          hasCover={artist.hasCover}
          size={320}
          eager={eager}
          rounded="rounded-full"
          className="aspect-square w-full shadow-card ring-1 ring-white/5 transition-all duration-300 ease-vault group-hover:shadow-lift group-hover:ring-accent-500/40"
        />
        <div className="absolute right-1 top-1 opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100">
          <FavoriteButton
            kind="artist"
            id={artist.id}
            label={artist.name}
            className="h-9 w-9 bg-black/50 backdrop-blur"
            size={15}
          />
        </div>
      </div>

      <div className="mt-3 space-y-0.5">
        <h3 className="truncate text-sm font-semibold text-zinc-100 transition-colors group-hover:text-white">
          {artist.name}
        </h3>
        <p className="truncate text-xs text-zinc-500">
          {formatNumber(artist.albumCount)} {artist.albumCount === 1 ? 'album' : 'albums'} ·{' '}
          {formatNumber(artist.trackCount)} tracks
        </p>
      </div>
    </Link>
  );
}
