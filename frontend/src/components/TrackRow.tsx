import { Link } from 'react-router-dom';
import { Download, ListPlus, Pause, Play } from 'lucide-react';

import { CoverImage } from './CoverImage';
import { FavoriteButton } from './FavoriteButton';
import { mediaUrl } from '../lib/api';
import { formatDuration, isHiRes, qualityLabel } from '../lib/format';
import { usePlayer } from '../context/PlayerContext';
import type { Track } from '../lib/types';

interface TrackRowProps {
  track: Track;
  /** The list this row belongs to — clicking plays the whole list in order. */
  tracks: Track[];
  index: number;
  /** Album view shows track numbers; search results show cover thumbnails. */
  variant?: 'album' | 'flat';
}

/** Animated bars shown in place of the track number while it is playing. */
function NowPlayingBars() {
  return (
    <span className="flex h-4 w-4 items-end justify-center gap-[2px]" aria-hidden>
      {[0, 1, 2].map((bar) => (
        <span
          key={bar}
          className="w-[3px] origin-bottom rounded-full bg-accent-400 animate-equalize"
          style={{ height: '100%', animationDelay: `${bar * 0.18}s` }}
        />
      ))}
    </span>
  );
}

export function TrackRow({ track, tracks, index, variant = 'flat' }: TrackRowProps) {
  const { current, isPlaying, playTracks, toggle, enqueue } = usePlayer();
  const isCurrent = current?.id === track.id;
  const hiRes = isHiRes(track);
  // On an album page every row would otherwise repeat the album artist.
  const hideArtist = variant === 'album' && track.artist === track.albumArtist;

  function handlePlay() {
    if (isCurrent) toggle();
    else playTracks(tracks, index);
  }

  return (
    <div
      className={`group grid grid-cols-[2.25rem_1fr_auto] items-center gap-3 rounded-xl px-2 py-2 transition-colors duration-200 sm:gap-4 sm:px-3 ${
        isCurrent ? 'bg-accent-500/10 ring-1 ring-inset ring-accent-500/20' : 'hover:bg-white/[0.04]'
      }`}
    >
      {/* Track number / cover, swapped for a play button on hover. */}
      <button
        type="button"
        onClick={handlePlay}
        aria-label={isCurrent && isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm tabular-nums text-zinc-500 transition-colors hover:text-white"
      >
        {variant === 'flat' && (
          <CoverImage
            id={track.coverId ?? track.albumId}
            name={track.album}
            size={128}
            rounded="rounded-lg"
            className="absolute inset-0 h-9 w-9"
          />
        )}

        <span
          className={`absolute inset-0 flex items-center justify-center rounded-lg transition-opacity duration-200 ${
            variant === 'flat' ? 'bg-black/55 opacity-0 group-hover:opacity-100' : 'opacity-100'
          } ${isCurrent ? 'opacity-100' : ''}`}
        >
          {isCurrent && isPlaying ? (
            variant === 'flat' ? (
              <Pause size={15} className="fill-current text-white" />
            ) : (
              <NowPlayingBars />
            )
          ) : isCurrent ? (
            <Play size={15} className="fill-current text-accent-300" />
          ) : variant === 'album' ? (
            <>
              <span className="group-hover:hidden">{track.trackNo ?? index + 1}</span>
              <Play size={15} className="hidden fill-current text-white group-hover:block" />
            </>
          ) : (
            <Play size={15} className="fill-current text-white" />
          )}
        </span>
      </button>

      {/* Title + secondary line. */}
      <div className="min-w-0">
        <button
          type="button"
          onClick={handlePlay}
          className="block max-w-full truncate text-left text-sm font-medium text-zinc-100 transition-colors hover:text-white"
        >
          <span className={isCurrent ? 'text-accent-200' : ''}>{track.title}</span>
        </button>
        <div
          className={`flex min-w-0 items-center gap-1.5 text-xs text-zinc-500 ${
            hideArtist ? 'hidden' : ''
          }`}
        >
          <Link
            to={`/artists/${track.artistId}`}
            className="truncate transition-colors hover:text-zinc-300 hover:underline"
          >
            {track.artist}
          </Link>
          {variant === 'flat' && (
            <>
              <span aria-hidden>·</span>
              <Link
                to={`/albums/${track.albumId}`}
                className="hidden truncate transition-colors hover:text-zinc-300 hover:underline sm:block"
              >
                {track.album}
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Badges + actions + duration. */}
      <div className="flex items-center gap-1 sm:gap-2">
        <span
          className={`hidden rounded-md px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide lg:inline-block ${
            hiRes
              ? 'bg-amber-400/10 text-amber-300'
              : track.lossless
                ? 'bg-emerald-400/10 text-emerald-300'
                : 'bg-white/5 text-zinc-500'
          }`}
          title={`${track.codec ?? track.ext.toUpperCase()}${
            track.bitrate ? ` · ${Math.round(track.bitrate / 1000)} kbps` : ''
          }`}
        >
          {qualityLabel(track)}
        </span>

        <div className="flex items-center opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover:opacity-100 max-sm:opacity-100">
          <button
            type="button"
            onClick={() => enqueue([track], 'end')}
            title="Add to queue"
            aria-label={`Add ${track.title} to the queue`}
            className="icon-btn hidden h-9 w-9 sm:inline-flex"
          >
            <ListPlus size={16} />
          </button>
          <a
            href={mediaUrl.download(track.id)}
            download
            onClick={(event) => event.stopPropagation()}
            title="Download"
            aria-label={`Download ${track.title}`}
            className="icon-btn h-9 w-9"
          >
            <Download size={16} />
          </a>
          <FavoriteButton kind="track" id={track.id} label={track.title} className="h-9 w-9" size={16} />
        </div>

        <span className="w-11 shrink-0 text-right text-xs tabular-nums text-zinc-500">
          {formatDuration(track.duration)}
        </span>
      </div>
    </div>
  );
}
