import { Link } from 'react-router-dom';
import { ArrowLeft, Heart, Play, Shuffle } from 'lucide-react';

import { PageHeader } from '../components/PageHeader';
import { TrackRow } from '../components/TrackRow';
import { EmptyState } from '../components/states';
import { usePlayer } from '../context/PlayerContext';
import { useFavorites } from '../context/FavoritesContext';
import { formatRuntime } from '../lib/format';

/**
 * Every track you have hearted.
 *
 * Its own page rather than a filter on the Library, because a list of songs
 * wants rows and the Library wants cards — trying to seat both in one grid is
 * what made the old Favourites page need tabs in the first place.
 */
export function LikedSongsPage() {
  const { items, ready } = useFavorites();
  const { playTracks } = usePlayer();

  const tracks = items.tracks;
  const runtime = tracks.reduce((total, track) => total + (track.duration ?? 0), 0);

  const shuffle = () => {
    // Copied before shuffling: the context's array is cache state, and sorting
    // it in place would quietly reorder what everything else is reading.
    const order = [...tracks];
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    playTracks(order, 0);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Liked songs"
        subtitle={
          tracks.length > 0
            ? `${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'} · ${formatRuntime(runtime)}`
            : 'Tracks you have hearted.'
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/library" className="btn-ghost">
              <ArrowLeft size={15} />
              Library
            </Link>
            {tracks.length > 0 && (
              <>
                <button type="button" onClick={() => playTracks(tracks, 0)} className="btn-primary">
                  <Play size={15} className="fill-current" />
                  Play
                </button>
                <button type="button" onClick={shuffle} className="btn-ghost">
                  <Shuffle size={15} />
                  Shuffle
                </button>
              </>
            )}
          </div>
        }
      />

      {!ready ? (
        <p className="surface p-8 text-sm text-zinc-500">Loading…</p>
      ) : tracks.length === 0 ? (
        <EmptyState
          icon={<Heart size={22} />}
          title="No liked songs yet"
          description="Tap the heart on any track and it turns up here — on every device you sign in on."
        />
      ) : (
        <div className="surface overflow-hidden">
          {tracks.map((track, index) => (
            <TrackRow
              key={track.id}
              track={track}
              tracks={tracks}
              index={index}
              variant="flat"
            />
          ))}
        </div>
      )}
    </div>
  );
}
