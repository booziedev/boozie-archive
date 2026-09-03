import { Heart } from 'lucide-react';

import { useFavorites, type FavoriteKind } from '../context/FavoritesContext';

interface FavoriteButtonProps {
  kind: FavoriteKind;
  id: string;
  label: string;
  className?: string;
  size?: number;
}

/** Star/heart toggle used on cards, track rows and detail headers. */
export function FavoriteButton({ kind, id, label, className = '', size = 18 }: FavoriteButtonProps) {
  const { isFavorite, toggle } = useFavorites();
  const active = isFavorite(kind, id);

  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={active ? `Remove ${label} from favourites` : `Add ${label} to favourites`}
      title={active ? 'Remove from favourites' : 'Add to favourites'}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        toggle(kind, id);
      }}
      className={`icon-btn ${active ? 'text-rose-400 hover:text-rose-300' : ''} ${className}`}
    >
      <Heart
        size={size}
        strokeWidth={2.2}
        className={`transition-transform duration-300 ease-vault ${active ? 'scale-110 fill-current' : ''}`}
      />
    </button>
  );
}
