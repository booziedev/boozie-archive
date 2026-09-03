import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronDown,
  Download,
  ListMusic,
  Loader2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';

import { CoverImage } from './CoverImage';
import { FavoriteButton } from './FavoriteButton';
import { QueuePanel } from './QueuePanel';
import { SeekBar } from './SeekBar';
import { mediaUrl } from '../lib/api';
import { formatDuration, qualityLabel } from '../lib/format';
import { usePlayer } from '../context/PlayerContext';

/**
 * The persistent transport bar.
 *
 * On phones it collapses to a single compact row that expands into a
 * full-screen "now playing" sheet — the interaction people expect from a music
 * app installed on an iOS home screen.
 */
export function Player() {
  const player = usePlayer();
  const [queueOpen, setQueueOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const {
    current,
    isPlaying,
    isLoading,
    currentTime,
    duration,
    volume,
    muted,
    shuffle,
    repeat,
    error,
  } = player;

  if (!current) return null;

  const effectiveDuration = duration || current.duration || 0;
  const coverId = current.coverId ?? current.albumId;

  const transport = (size: 'sm' | 'lg') => (
    <div className={`flex items-center ${size === 'lg' ? 'gap-4' : 'gap-1 sm:gap-2'}`}>
      <button
        type="button"
        onClick={player.toggleShuffle}
        aria-pressed={shuffle}
        title="Shuffle"
        className={`icon-btn ${size === 'lg' ? '' : 'hidden sm:inline-flex'} ${
          shuffle ? 'text-accent-400 hover:text-accent-300' : ''
        }`}
      >
        <Shuffle size={size === 'lg' ? 20 : 17} />
      </button>

      <button type="button" onClick={player.previous} title="Previous" className="icon-btn">
        <SkipBack size={size === 'lg' ? 26 : 19} className="fill-current" />
      </button>

      <button
        type="button"
        onClick={player.toggle}
        aria-label={isPlaying ? 'Pause' : 'Play'}
        className={`flex items-center justify-center rounded-full bg-white text-ink-950 shadow-lg transition-transform duration-200 ease-vault hover:scale-105 active:scale-95 ${
          size === 'lg' ? 'h-16 w-16' : 'h-10 w-10'
        }`}
      >
        {isLoading ? (
          <Loader2 size={size === 'lg' ? 26 : 18} className="animate-spin" />
        ) : isPlaying ? (
          <Pause size={size === 'lg' ? 26 : 18} className="fill-current" />
        ) : (
          <Play size={size === 'lg' ? 26 : 18} className="ml-0.5 fill-current" />
        )}
      </button>

      <button type="button" onClick={player.next} title="Next" className="icon-btn">
        <SkipForward size={size === 'lg' ? 26 : 19} className="fill-current" />
      </button>

      <button
        type="button"
        onClick={player.cycleRepeat}
        aria-pressed={repeat !== 'off'}
        title={`Repeat: ${repeat}`}
        className={`icon-btn ${size === 'lg' ? '' : 'hidden sm:inline-flex'} ${
          repeat !== 'off' ? 'text-accent-400 hover:text-accent-300' : ''
        }`}
      >
        {repeat === 'one' ? <Repeat1 size={size === 'lg' ? 20 : 17} /> : <Repeat size={size === 'lg' ? 20 : 17} />}
      </button>
    </div>
  );

  const progress = (
    <div className="flex w-full items-center gap-2.5">
      <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-zinc-500">
        {formatDuration(currentTime)}
      </span>
      <SeekBar
        value={currentTime}
        max={effectiveDuration}
        onCommit={player.seek}
        ariaLabel="Seek"
        disabled={effectiveDuration <= 0}
        className="flex-1"
      />
      <span className="w-10 shrink-0 text-[11px] tabular-nums text-zinc-500">
        {formatDuration(effectiveDuration)}
      </span>
    </div>
  );

  return (
    <>
      {/* ---------------- expanded now-playing sheet (mobile) ------------- */}
      <div
        aria-hidden={!expanded}
        className={`fixed inset-0 z-50 flex flex-col bg-ink-950/95 backdrop-blur-2xl transition-transform duration-300 ease-vault lg:hidden ${
          expanded ? 'translate-y-0' : 'pointer-events-none translate-y-full'
        }`}
      >
        <div className="flex items-center justify-between px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <button
            type="button"
            onClick={() => setExpanded(false)}
            aria-label="Close now playing"
            className="icon-btn"
          >
            <ChevronDown size={22} />
          </button>
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Now playing
          </span>
          <button
            type="button"
            onClick={() => setQueueOpen(true)}
            aria-label="Open queue"
            className="icon-btn"
          >
            <ListMusic size={20} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col justify-center gap-6 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <CoverImage
            id={coverId}
            name={current.album}
            size={640}
            eager
            rounded="rounded-3xl"
            className="mx-auto aspect-square w-full max-w-sm shadow-lift"
          />

          <div className="space-y-1.5 text-center">
            <h2 className="truncate text-xl font-bold text-white">{current.title}</h2>
            <Link
              to={`/artists/${current.artistId}`}
              onClick={() => setExpanded(false)}
              className="block truncate text-sm text-zinc-400 hover:text-zinc-200"
            >
              {current.artist}
            </Link>
            <div className="flex items-center justify-center gap-2 pt-1">
              <span className="pill">{qualityLabel(current)}</span>
              {current.year && <span className="pill">{current.year}</span>}
            </div>
          </div>

          {progress}

          <div className="flex items-center justify-center">{transport('lg')}</div>

          <div className="flex items-center justify-center gap-2">
            <FavoriteButton kind="track" id={current.id} label={current.title} />
            <a
              href={mediaUrl.download(current.id)}
              download
              className="icon-btn"
              aria-label={`Download ${current.title}`}
            >
              <Download size={19} />
            </a>
          </div>
        </div>
      </div>

      {/* ---------------- persistent bar ---------------------------------- */}
      {/* Sits directly above the mobile tab bar; flush to the bottom on desktop. */}
      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 border-t border-white/5 bg-ink-900/80 backdrop-blur-2xl animate-slide-up lg:bottom-0">
        {error && (
          <p className="bg-red-500/15 px-4 py-1.5 text-center text-xs text-red-300">{error}</p>
        )}

        {/* Thin progress line, mobile only (the sheet has the real slider). */}
        <div className="h-0.5 w-full bg-white/5 lg:hidden">
          <div
            className="h-full bg-accent-500 transition-[width] duration-300 ease-linear"
            style={{
              width: effectiveDuration > 0 ? `${(currentTime / effectiveDuration) * 100}%` : '0%',
            }}
          />
        </div>

        <div className="mx-auto flex max-w-[1800px] items-center gap-3 px-3 py-2.5 sm:px-4 lg:gap-6 lg:pb-[max(0.625rem,env(safe-area-inset-bottom))]">
          {/* Track identity */}
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="flex min-w-0 flex-1 items-center gap-3 text-left lg:w-72 lg:flex-none lg:cursor-default"
          >
            <CoverImage
              id={coverId}
              name={current.album}
              size={128}
              rounded="rounded-lg"
              className="h-12 w-12 shrink-0 shadow-card"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-zinc-100">
                {current.title}
              </span>
              <span className="block truncate text-xs text-zinc-500">{current.artist}</span>
            </span>
          </button>

          <div className="hidden lg:block">
            <FavoriteButton kind="track" id={current.id} label={current.title} size={17} />
          </div>

          {/* Centre column: transport + seek (desktop) */}
          <div className="flex flex-col items-center gap-1.5 lg:flex-1">
            {transport('sm')}
            <div className="hidden w-full max-w-2xl lg:block">{progress}</div>
          </div>

          {/* Right column: volume, download, queue (desktop) */}
          <div className="hidden items-center gap-2 lg:flex lg:w-72 lg:justify-end">
            <button
              type="button"
              onClick={player.toggleMute}
              aria-label={muted ? 'Unmute' : 'Mute'}
              className="icon-btn"
            >
              {muted || volume === 0 ? (
                <VolumeX size={18} />
              ) : volume < 0.5 ? (
                <Volume1 size={18} />
              ) : (
                <Volume2 size={18} />
              )}
            </button>
            <SeekBar
              value={muted ? 0 : volume}
              max={1}
              step={0.01}
              onInput={player.setVolume}
              onCommit={player.setVolume}
              ariaLabel="Volume"
              className="w-24"
            />
            <a
              href={mediaUrl.download(current.id)}
              download
              className="icon-btn"
              aria-label={`Download ${current.title}`}
            >
              <Download size={18} />
            </a>
            <button
              type="button"
              onClick={() => setQueueOpen(true)}
              aria-label="Open queue"
              className={`icon-btn ${queueOpen ? 'text-accent-400' : ''}`}
            >
              <ListMusic size={19} />
            </button>
          </div>
        </div>
      </div>

      <QueuePanel open={queueOpen} onClose={() => setQueueOpen(false)} />
    </>
  );
}
