import { ListMusic, Trash2, X } from 'lucide-react';
import { Link } from 'react-router-dom';

import { CoverImage } from './CoverImage';
import { formatDuration } from '../lib/format';
import { usePlayer } from '../context/PlayerContext';

/** Slide-in drawer listing the current play order. */
export function QueuePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { queue, order, position, jumpTo, removeAt, clearQueue, current } = usePlayer();

  return (
    <>
      <div
        role="presentation"
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      <aside
        aria-label="Play queue"
        aria-hidden={!open}
        className={`fixed right-0 top-0 z-50 flex h-[100dvh] w-full max-w-sm flex-col border-l border-white/10 bg-ink-900/95 shadow-2xl backdrop-blur-2xl transition-transform duration-300 ease-vault ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <header className="flex items-center justify-between gap-3 border-b border-white/5 px-4 pb-3 pt-[max(0.875rem,env(safe-area-inset-top))]">
          <div className="flex items-center gap-2">
            <ListMusic size={18} className="text-accent-400" />
            <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-300">Queue</h2>
            <span className="pill">{order.length}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={clearQueue}
              disabled={order.length === 0}
              title="Clear queue"
              className="icon-btn h-9 w-9"
            >
              <Trash2 size={16} />
            </button>
            <button type="button" onClick={onClose} aria-label="Close queue" className="icon-btn h-9 w-9">
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          {order.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-zinc-500">
              Nothing queued yet. Play an album or a track to get started.
            </p>
          ) : (
            <ol className="space-y-0.5">
              {order.map((queueIndex, orderPosition) => {
                const track = queue[queueIndex];
                if (!track) return null;
                const isCurrent = orderPosition === position && current?.id === track.id;

                return (
                  <li key={`${track.id}-${orderPosition}`}>
                    <div
                      className={`group flex items-center gap-3 rounded-xl px-2 py-2 transition-colors ${
                        isCurrent ? 'bg-accent-500/15' : 'hover:bg-white/5'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => jumpTo(orderPosition)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <CoverImage
                          id={track.coverId ?? track.albumId}
                          name={track.album}
                          size={128}
                          rounded="rounded-lg"
                          className="h-10 w-10 shrink-0"
                        />
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block truncate text-sm font-medium ${
                              isCurrent ? 'text-accent-200' : 'text-zinc-200'
                            }`}
                          >
                            {track.title}
                          </span>
                          <span className="block truncate text-xs text-zinc-500">{track.artist}</span>
                        </span>
                      </button>

                      <span className="shrink-0 text-xs tabular-nums text-zinc-600">
                        {formatDuration(track.duration)}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeAt(orderPosition)}
                        aria-label={`Remove ${track.title} from the queue`}
                        className="icon-btn h-8 w-8 opacity-0 group-hover:opacity-100 max-sm:opacity-100"
                      >
                        <X size={15} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        {current && (
          <footer className="border-t border-white/5 px-4 py-3 text-xs text-zinc-500">
            Now playing from{' '}
            <Link to={`/albums/${current.albumId}`} onClick={onClose} className="text-zinc-300 hover:underline">
              {current.album}
            </Link>
          </footer>
        )}
      </aside>
    </>
  );
}
