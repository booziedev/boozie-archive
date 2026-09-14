import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Disc3, ListMusic, Maximize2, MicVocal, Minimize2 } from 'lucide-react';

import { LyricsView } from './LyricsView';
import { mediaUrl } from '../lib/api';
import { qualityLabel } from '../lib/format';
import { usePalette } from '../lib/palette';
import type { Track } from '../lib/types';

/**
 * The full-screen now-playing view.
 *
 * This was a mobile-only sheet inside the player bar, hidden above `lg` — which
 * meant the desktop had no way to see the artwork any bigger than a 48px tile.
 * It is one screen at every size now: the same thing a phone gets by tapping
 * the track, and what the bar's fullscreen button opens on a laptop.
 *
 * The background is drawn from the cover's own colours (see `lib/palette.ts`),
 * three slowly drifting blobs of them behind a heavy blur. When the artwork
 * cannot be sampled — it failed to load, or the canvas came back tainted — the
 * base layer underneath is a flat near-black that looks deliberate on its own,
 * so there is nothing to fall back *to*; it simply stays dark.
 */

export type NowPlayingView = 'art' | 'lyrics';

interface NowPlayingScreenProps {
  /** Null when closed. Opening in 'lyrics' is what the bar's lyrics button does. */
  view: NowPlayingView | null;
  onChangeView: (view: NowPlayingView) => void;
  onClose: () => void;
  /** True when the caller wants the browser's own fullscreen as well. */
  wantFullscreen: boolean;
  track: Track;
  live: boolean;
  onOpenQueue: () => void;
  /** Built by the player bar, so the transport exists in exactly one place. */
  artwork: (className: string, iconSize: number) => ReactNode;
  transport: ReactNode;
  progress: ReactNode;
  actions: ReactNode;
  /**
   * The two buttons that flank the title.
   *
   * They live beside the name of the thing they act on rather than in a row of
   * their own at the bottom. Both slots are always rendered, even when one has
   * nothing to put in it — a station has nothing to favourite — because an
   * empty slot still has to hold its width or the title stops being centred.
   */
  titleLeading: ReactNode;
  titleTrailing: ReactNode;
}

/**
 * Browser fullscreen, where the browser has it.
 *
 * An enhancement, never a requirement: iOS Safari has no element fullscreen at
 * all, and every browser refuses the request unless it came from a gesture. The
 * overlay covers the viewport by itself, so a refusal costs nothing and is
 * swallowed. The `fullscreenchange` listener is what makes Esc — which leaves
 * fullscreen without telling React — keep the button honest.
 */
function useFullscreen(target: React.RefObject<HTMLElement>, wanted: boolean, open: boolean) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const sync = () => setActive(document.fullscreenElement === target.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, [target]);

  const enter = useCallback(() => {
    const element = target.current;
    if (!element || document.fullscreenElement) return;
    void element.requestFullscreen?.().catch(() => undefined);
  }, [target]);

  const exit = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (open && wanted) enter();
    if (!open) exit();
  }, [open, wanted, enter, exit]);

  return { active, enter, exit };
}

/**
 * A ref, and the live height of whatever it is attached to.
 *
 * The artwork has to be capped against the room actually left under the
 * controls, and that height genuinely moves: the quality pills vanish in
 * lyrics mode, the actions row changes with listen-along and with radio, and
 * the safe-area inset differs per device. Measuring beats picking a number
 * that is wrong on three devices out of four — the same reasoning, and the
 * same ResizeObserver, as `--chrome-bottom` in `Layout.tsx`.
 */
function useMeasuredHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setHeight(element.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, height };
}

export function NowPlayingScreen({
  view,
  onChangeView,
  onClose,
  wantFullscreen,
  track,
  live,
  onOpenQueue,
  artwork,
  transport,
  progress,
  actions,
  titleLeading,
  titleTrailing,
}: NowPlayingScreenProps) {
  const open = view !== null;
  const shell = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(shell, wantFullscreen, open);

  // A station has no cover to sample, and a track without artwork would only
  // give us the placeholder gradient's colours back.
  const coverId = track.coverId ?? track.albumId;
  const palette = usePalette(live || !coverId ? null : mediaUrl.cover(coverId, 320));

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // In most browsers Esc inside fullscreen is swallowed by the browser and
      // only leaves fullscreen, so this fires on the second press. Where it
      // does reach us, closing is still what was meant — and closing releases
      // fullscreen on the way out.
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const lyrics = view === 'lyrics';
  const controls = useMeasuredHeight();
  const header = useMeasuredHeight();

  return (
    <div
      ref={shell}
      aria-hidden={!open}
      aria-label="Now playing"
      className={`fixed inset-0 z-50 flex flex-col overflow-hidden bg-ink-950 transition-transform duration-300 ease-vault ${
        open ? 'translate-y-0' : 'pointer-events-none translate-y-full'
      }`}
      style={{
        ['--np-controls' as string]: controls.height ? `${controls.height}px` : undefined,
        ['--np-header' as string]: header.height ? `${header.height}px` : undefined,
      }}
    >
      {/* ----------------------- the colour wash ----------------------- */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {palette?.map((colour, index) => (
          <div
            key={`${colour}-${index}`}
            className="absolute h-[85vmax] w-[85vmax] rounded-full opacity-70 blur-[100px] animate-drift"
            style={{
              // Solid to two thirds, then out: a gradient that starts fading
              // immediately is almost invisible once the blur and the vignette
              // have both had a go at it.
              background: `radial-gradient(circle, ${colour} 0%, ${colour} 35%, transparent 72%)`,
              // Spread across the viewport so the three never stack up and no
              // corner is left obviously empty.
              left: `${[-25, 45, 5][index]}%`,
              top: `${[-30, -10, 35][index]}%`,
              animationDelay: `${index * -8}s`,
            }}
          />
        ))}
        {/* Darkened top and bottom, where the controls and the title sit, and
            left alone through the middle where the artwork is. */}
        <div className="absolute inset-0 bg-gradient-to-b from-ink-950/60 via-ink-950/10 to-ink-950/80" />
      </div>

      {/*
        ------------------------- the header --------------------------

        Three columns rather than a `justify-between` row. The right-hand
        cluster holds two or three buttons depending on the breakpoint and on
        whether radio is playing, so spacing the row out put the label
        wherever the gap between the sides happened to fall — visibly left of
        centre. Equal side tracks put the middle on the centre line whatever
        the sides weigh.

        `minmax(0,1fr)` rather than a bare `1fr`, because `1fr` keeps a
        content-sized minimum: at 320px the buttons are wider than their share
        and the track grows for them, which is exactly the imbalance this is
        here to remove. Zeroing the minimum keeps the two sides identical and
        lets the label truncate instead.
      */}
      <div
        ref={header.ref}
        className="relative grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close now playing"
          className="icon-btn justify-self-start"
        >
          <ChevronDown size={22} />
        </button>

        <span className="min-w-0 truncate text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-400">
          {lyrics ? 'Lyrics' : 'Now playing'}
        </span>

        <div className="flex items-center gap-1 justify-self-end">
          {!live && (
            <button
              type="button"
              onClick={() => onChangeView(lyrics ? 'art' : 'lyrics')}
              aria-pressed={lyrics}
              title={lyrics ? 'Show artwork' : 'Show lyrics'}
              aria-label={lyrics ? 'Show artwork' : 'Show lyrics'}
              className={`icon-btn ${lyrics ? 'text-accent-400' : ''}`}
            >
              {lyrics ? <Disc3 size={19} /> : <MicVocal size={19} />}
            </button>
          )}
          <button
            type="button"
            onClick={() => (fullscreen.active ? fullscreen.exit() : fullscreen.enter())}
            aria-pressed={fullscreen.active}
            title={fullscreen.active ? 'Leave fullscreen' : 'Fullscreen'}
            aria-label={fullscreen.active ? 'Leave fullscreen' : 'Fullscreen'}
            className="icon-btn hidden sm:inline-flex"
          >
            {fullscreen.active ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          <button type="button" onClick={onOpenQueue} aria-label="Open queue" className="icon-btn">
            <ListMusic size={20} />
          </button>
        </div>
      </div>

      {/* -------------------------- the body --------------------------- */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {lyrics ? (
          <LyricsView track={track} active={open && lyrics} />
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-2">
            {/*
              Capped against the height that is genuinely left, not against a
              share of the viewport. `52vh` took no account of the ~370px of
              header and controls above and below it, so anything shorter than
              about 750px — a short desktop window, and every phone turned on
              its side — was drawing a square taller than the box holding it
              and letting the screen's `overflow-hidden` slice it.

              Both ends are measured rather than allowed for, because on a
              rotated phone the difference between an exact figure and a safe
              one is the difference between a recognisable cover and a dot.
            */}
            {artwork(
              'short:rounded-xl aspect-square w-full max-w-[min(70vw,calc(100dvh-var(--np-controls,20rem)-var(--np-header,4rem)-1rem))] rounded-3xl shadow-lift',
              96,
            )}
          </div>
        )}

        {/* The transport sits under both views: pausing should not cost you
            your place in the lyrics. */}
        <div
          ref={controls.ref}
          className="short:space-y-3 short:pt-2 shrink-0 space-y-5 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4"
        >
          {/*
            Three columns rather than a centred flex row: the side cells hold
            one icon button each and are the same width, so the middle column
            is centred on the screen and not merely on whatever space the
            buttons left over. `minmax(0,…)` is what lets the title truncate
            instead of widening its track and pushing the centre off.
          */}
          <div className="mx-auto grid max-w-xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
            <span className="flex items-center justify-center">{titleLeading}</span>

            <div className="min-w-0 space-y-1.5 text-center">
              <h2 className="short:text-base truncate text-xl font-bold text-white">{track.title}</h2>
              {live ? (
                <p className="truncate text-sm text-zinc-400">{track.album}</p>
              ) : (
                <Link
                  to={`/artists/${track.artistId}`}
                  onClick={onClose}
                  className="block truncate text-sm text-zinc-400 transition-colors hover:text-zinc-200"
                >
                  {track.artist}
                </Link>
              )}
              {/* The pills are reference, not control, so they are what gives
                  way when a rotated phone needs the room for the cover. */}
              {!lyrics && (
                <div className="short:hidden flex items-center justify-center gap-2 pt-1">
                  <span className="pill">{live ? (track.codec ?? 'Live') : qualityLabel(track)}</span>
                  {!live && track.year && <span className="pill">{track.year}</span>}
                </div>
              )}
            </div>

            <span className="flex items-center justify-center">{titleTrailing}</span>
          </div>

          <div className="mx-auto max-w-xl">{progress}</div>
          <div className="flex items-center justify-center">{transport}</div>
          {/*
            Only listen-along lives here now, but the row keeps the height it
            had when the sleep timer and the heart were in it.

            Collapsing it instead moved everything: the artwork wrapper above is
            `flex-1 items-center`, so the freed row and its `space-y` step were
            absorbed as surplus and split evenly above and below the cover. The
            cover could not grow into it — in portrait its cap is the `70vw`
            term — so the whole screen simply slid down by half of it while the
            controls slid down by all of it. Reserving the height keeps every
            other element exactly where it was; the strip is just empty now.
          */}
          <div className="flex min-h-10 items-center justify-center gap-2">{actions}</div>
        </div>
      </div>
    </div>
  );
}
