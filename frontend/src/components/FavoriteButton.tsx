import { Heart } from 'lucide-react';

import { useAuth } from '../context/AuthContext';
import { useFavorites, type FavoriteKind } from '../context/FavoritesContext';

interface FavoriteButtonProps {
  kind: FavoriteKind;
  id: string;
  label: string;
  className?: string;
  size?: number;
}

/**
 * Heart toggle used on cards, track rows and detail headers.
 *
 * Absent when nobody is signed in. Favourites belong to an account now, so
 * there would be nowhere to put one — and a heart that silently does nothing
 * is worse than no heart at all.
 */
export function FavoriteButton({ kind, id, label, className = '', size = 18 }: FavoriteButtonProps) {
  const { user } = useAuth();
  const { isFavorite, toggle } = useFavorites();
  if (!user) return null;

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
