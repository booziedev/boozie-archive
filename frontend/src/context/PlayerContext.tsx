import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';

import { mediaUrl } from '../lib/api';
import { mediaCrossOrigin } from '../lib/config';
import type { Track } from '../lib/types';

/**
 * Audio playback.
 *
 * Design notes for iOS Safari (including the installed home-screen app):
 *  - exactly ONE <audio> element exists for the lifetime of the app and its
 *    `src` is swapped between tracks. Creating a fresh element per track breaks
 *    playback, because only an element "unlocked" by a user gesture may play;
 *  - `play()` is always reached synchronously from the click handler chain;
 *  - the Media Session API drives the lock screen / control centre widget,
 *    which is what makes the installed PWA feel like a native player;
 *  - seeking relies on the backend answering HTTP range requests with 206.
 *
 * Queue, play order and position live in a single state object so that a
 * shuffle toggle or an enqueue is one atomic update rather than three setters
 * racing each other.
 */

const VOLUME_KEY = 'boozie.player.volume';
const SESSION_KEY = 'boozie.player.session.v1';
/** Cap on how much of a queue we persist between visits. */
const MAX_PERSISTED = 200;

export type RepeatMode = 'off' | 'all' | 'one';

interface Playback {
  queue: Track[];
  /** Playback order (indices into `queue`); differs from queue when shuffled. */
  order: number[];
  /** Index into `order`, not into `queue`. */
  position: number;
}

const EMPTY_PLAYBACK: Playback = { queue: [], order: [], position: 0 };

interface PersistedSession extends Playback {
  time: number;
  shuffle: boolean;
  repeat: RepeatMode;
}

export interface PlayerContextValue extends Playback {
  current: Track | null;
  /**
   * The track the audio element is actually pointed at.
   *
   * Lags `current` by one effect: `current` changes as soon as the queue does,
   * while this waits until the element has been re-pointed. Anything reporting
   * "what is playing, and where" must key off this pair, or it will publish a
   * new track id next to the previous track's position.
   */
  loadedTrackId: string | null;
  isPlaying: boolean;
  isLoading: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  error: string | null;

  playTracks: (tracks: Track[], startIndex?: number) => void;
  playNow: (track: Track) => void;
  /**
   * Loads one track and starts it partway in. Used by listen-along to follow
   * a host: it replaces the queue rather than adding to it, because a guest is
   * mirroring someone else's player, not building their own.
   */
  playAt: (track: Track, seconds: number, autoplay?: boolean) => void;
  toggle: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
  skipBy: (seconds: number) => void;
  /** The element's own position, which never lags behind React state. */
  getPosition: () => number;
  setVolume: (value: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  jumpTo: (orderPosition: number) => void;
  enqueue: (tracks: Track[], mode?: 'next' | 'end') => void;
  removeAt: (orderPosition: number) => void;
  clearQueue: () => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

/** Fisher–Yates over a copy. */
function shuffled(values: number[]): number[] {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function readVolume(): number {
  try {
    const raw = Number.parseFloat(localStorage.getItem(VOLUME_KEY) ?? '');
    return Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 1;
  } catch {
    return 1;
  }
}

function readSession(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedSession;
    if (!Array.isArray(parsed.queue) || parsed.queue.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const restored = useRef(false);
  /** Set when playback should start as soon as the new src is ready. */
  const autoplayRef = useRef(false);
  /** Position to restore into the element once metadata for it has loaded. */
  const resumeTimeRef = useRef(0);

  const [playback, setPlayback] = useState<Playback>(EMPTY_PLAYBACK);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [loadedTrackId, setLoadedTrackId] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(readVolume);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>('off');
  const [error, setError] = useState<string | null>(null);

  const { queue, order, position } = playback;

  const current = useMemo(() => {
    const index = order[position];
    return index === undefined ? null : (queue[index] ?? null);
  }, [order, position, queue]);

  // One audio element for the whole app lifetime.
  if (audioRef.current === null && typeof window !== 'undefined') {
    const audio = new Audio();
    audio.preload = 'metadata';
    // Only set when the API is cross-origin: the attribute makes the browser
    // send the session cookie, but demands CORS headers in return.
    const crossOrigin = mediaCrossOrigin();
    if (crossOrigin) audio.crossOrigin = crossOrigin;
    audioRef.current = audio;
  }

  /** Restores the last session (paused) so reopening the PWA feels continuous. */
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const session = readSession();
    if (!session) return;
    const order =
      session.order.length === session.queue.length
        ? session.order
        : session.queue.map((_, index) => index);
    setPlayback({
      queue: session.queue,
      order,
      position: Math.min(Math.max(0, session.position), Math.max(0, order.length - 1)),
    });
    setShuffle(Boolean(session.shuffle));
    setRepeat(session.repeat ?? 'off');
    resumeTimeRef.current = session.time ?? 0;
    setCurrentTime(session.time ?? 0);
  }, []);

  /** Persists queue + position whenever the track or queue changes. */
  useEffect(() => {
    if (!restored.current) return;
    try {
      if (queue.length === 0) {
        localStorage.removeItem(SESSION_KEY);
        return;
      }
      const payload: PersistedSession = {
        queue: queue.slice(0, MAX_PERSISTED),
        order: order.filter((index) => index < MAX_PERSISTED),
        position: Math.min(position, MAX_PERSISTED - 1),
        time: audioRef.current?.currentTime ?? 0,
        shuffle,
        repeat,
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
    } catch {
      // Quota errors are non-fatal; playback is unaffected.
    }
  }, [queue, order, position, shuffle, repeat]);

  const startElement = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const promise = audio.play();
    if (promise) {
      promise.catch((reason: DOMException) => {
        // NotAllowedError = no user gesture yet (autoplay policy): stay paused.
        if (reason?.name !== 'AbortError') setIsPlaying(false);
        if (reason?.name === 'NotSupportedError') {
          setError('This browser cannot play this file format.');
        }
      });
    }
  }, []);

  /** Loads the current track into the audio element whenever it changes. */
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!current) {
      audio.removeAttribute('src');
      audio.load();
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      setLoadedTrackId(null);
      return;
    }

    const url = mediaUrl.stream(current.id);
    if (audio.src === url) {
      setLoadedTrackId(current.id);
      if (autoplayRef.current) startElement();
      return;
    }

    setError(null);
    setIsLoading(true);
    setCurrentTime(resumeTimeRef.current);
    setDuration(current.duration ?? 0);
    audio.src = url;
    audio.load();
    setLoadedTrackId(current.id);
    if (autoplayRef.current) startElement();
  }, [current, startElement]);

  // --- transport ---------------------------------------------------------

  const goTo = useCallback((nextPosition: number, autoplay: boolean) => {
    autoplayRef.current = autoplay;
    resumeTimeRef.current = 0;
    setPlayback((state) => {
      if (nextPosition < 0 || nextPosition >= state.order.length) return state;
      return { ...state, position: nextPosition };
    });
  }, []);

  const next = useCallback(() => {
    if (order.length === 0) return;
    if (position + 1 < order.length) {
      goTo(position + 1, true);
    } else if (repeat === 'all') {
      goTo(0, true);
    } else {
      // End of the queue: stop on the last track instead of clearing it.
      audioRef.current?.pause();
      setIsPlaying(false);
    }
  }, [goTo, order.length, position, repeat]);

  const previous = useCallback(() => {
    const audio = audioRef.current;
    // Standard player behaviour: restart the track unless we're near its start.
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    if (position > 0) goTo(position - 1, true);
    else if (audio) audio.currentTime = 0;
  }, [goTo, position]);

  const handleEnded = useCallback(() => {
    const audio = audioRef.current;
    if (repeat === 'one' && audio) {
      audio.currentTime = 0;
      void audio.play();
      return;
    }
    next();
  }, [next, repeat]);

  // --- audio element events ----------------------------------------------
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onWaiting = () => setIsLoading(true);
    const onPlaying = () => {
      setIsLoading(false);
      setError(null);
    };
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoadedMetadata = () => {
      setIsLoading(false);
      if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
      // Restore the position saved from the previous visit, once.
      if (resumeTimeRef.current > 0) {
        audio.currentTime = Math.min(resumeTimeRef.current, audio.duration || 0);
        resumeTimeRef.current = 0;
      }
    };
    const onError = () => {
      setIsLoading(false);
      setIsPlaying(false);
      setError('Playback failed — the file may be missing on the server or unsupported here.');
    };

    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('durationchange', onLoadedMetadata);
    audio.addEventListener('error', onError);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('durationchange', onLoadedMetadata);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [handleEnded]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    audio.muted = muted;
    try {
      localStorage.setItem(VOLUME_KEY, String(volume));
    } catch {
      // Non-fatal.
    }
  }, [volume, muted]);

  const playTracks = useCallback(
    (tracks: Track[], startIndex = 0) => {
      if (tracks.length === 0) return;
      const safeStart = Math.min(Math.max(0, startIndex), tracks.length - 1);
      const indices = tracks.map((_, index) => index);
      const nextOrder = shuffle
        ? [safeStart, ...shuffled(indices.filter((index) => index !== safeStart))]
        : indices;
      const nextPosition = shuffle ? 0 : safeStart;

      autoplayRef.current = true;
      resumeTimeRef.current = 0;
      setPlayback({ queue: tracks, order: nextOrder, position: nextPosition });

      // When the very same track is already loaded, `current` does not change,
      // so the load effect won't fire — start playback here instead. This also
      // keeps the call inside the user's click gesture, which iOS requires.
      if (current?.id === tracks[safeStart]?.id) startElement();
    },
    [current?.id, shuffle, startElement],
  );

  const playNow = useCallback((track: Track) => playTracks([track], 0), [playTracks]);

  const playAt = useCallback(
    (track: Track, seconds: number, autoplay = true) => {
      const target = Math.max(0, seconds);
      autoplayRef.current = autoplay;
      resumeTimeRef.current = target;
      setPlayback({ queue: [track], order: [0], position: 0 });

      // Already on this track: `current` doesn't change, so the load effect
      // won't run — jump and start here instead, still inside whatever gesture
      // called us, which is what lets iOS begin playback.
      if (current?.id === track.id) {
        const audio = audioRef.current;
        if (audio) {
          audio.currentTime = target;
          setCurrentTime(target);
          resumeTimeRef.current = 0;
          if (autoplay) startElement();
        }
      }
    },
    [current?.id, startElement],
  );

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    if (audio.paused) {
      autoplayRef.current = true;
      startElement();
    } else {
      audio.pause();
    }
  }, [current, startElement]);

  const pause = useCallback(() => audioRef.current?.pause(), []);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const target = Math.max(0, seconds);
    // Assigning currentTime triggers a fresh HTTP range request server-side.
    audio.currentTime = target;
    setCurrentTime(target);
  }, []);

  const getPosition = useCallback(() => audioRef.current?.currentTime ?? 0, []);

  const skipBy = useCallback(
    (seconds: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      const limit = Number.isFinite(audio.duration) ? audio.duration : Number.MAX_SAFE_INTEGER;
      seek(Math.min(limit, audio.currentTime + seconds));
    },
    [seek],
  );

  const setVolume = useCallback((value: number) => {
    const clamped = Math.min(1, Math.max(0, value));
    setVolumeState(clamped);
    if (clamped > 0) setMuted(false);
  }, []);

  const toggleShuffle = useCallback(() => {
    const nextShuffle = !shuffle;
    setShuffle(nextShuffle);
    setPlayback((state) => {
      const playing = state.order[state.position];
      if (playing === undefined) return state;
      if (nextShuffle) {
        const rest = state.order.filter((index) => index !== playing);
        return { ...state, order: [playing, ...shuffled(rest)], position: 0 };
      }
      const natural = [...state.order].sort((a, b) => a - b);
      return { ...state, order: natural, position: Math.max(0, natural.indexOf(playing)) };
    });
  }, [shuffle]);

  const cycleRepeat = useCallback(() => {
    setRepeat((mode) => (mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off'));
  }, []);

  const jumpTo = useCallback((orderPosition: number) => goTo(orderPosition, true), [goTo]);

  const enqueue = useCallback((tracks: Track[], mode: 'next' | 'end' = 'end') => {
    if (tracks.length === 0) return;
    setPlayback((state) => {
      const offset = state.queue.length;
      const added = tracks.map((_, index) => offset + index);
      const order =
        mode === 'next'
          ? [
              ...state.order.slice(0, state.position + 1),
              ...added,
              ...state.order.slice(state.position + 1),
            ]
          : [...state.order, ...added];
      return { queue: [...state.queue, ...tracks], order, position: state.position };
    });
  }, []);

  const removeAt = useCallback((orderPosition: number) => {
    setPlayback((state) => {
      if (orderPosition < 0 || orderPosition >= state.order.length) return state;
      const order = state.order.filter((_, index) => index !== orderPosition);
      let position = state.position;
      if (orderPosition < state.position) position -= 1;
      position = Math.max(0, Math.min(position, Math.max(0, order.length - 1)));
      return { ...state, order, position };
    });
  }, []);

  const clearQueue = useCallback(() => {
    audioRef.current?.pause();
    setPlayback(EMPTY_PLAYBACK);
    setIsPlaying(false);
  }, []);

  // --- Media Session (iOS lock screen / control centre) -------------------
  useEffect(() => {
    if (!('mediaSession' in navigator) || !current) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: current.artist,
      album: current.album,
      artwork: ([128, 320, 640] as const).map((size) => ({
        src: mediaUrl.cover(current.coverId ?? current.albumId, size),
        sizes: `${size}x${size}`,
        type: 'image/jpeg',
      })),
    });

    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => toggle()],
      ['pause', () => pause()],
      ['previoustrack', () => previous()],
      ['nexttrack', () => next()],
      ['seekbackward', () => skipBy(-10)],
      ['seekforward', () => skipBy(10)],
      [
        'seekto',
        (details) => {
          if (typeof details.seekTime === 'number') seek(details.seekTime);
        },
      ],
    ];

    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Not every action is supported by every browser.
      }
    }

    return () => {
      for (const [action] of handlers) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          // Ignore.
        }
      }
    };
  }, [current, next, pause, previous, seek, skipBy, toggle]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }, [isPlaying]);

  /** Keeps the lock-screen scrubber in sync with the element. */
  useEffect(() => {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    if (!Number.isFinite(duration) || duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        position: Math.min(currentTime, duration),
        playbackRate: 1,
      });
    } catch {
      // Safari throws while a seek is in flight; harmless.
    }
  }, [currentTime, duration]);

  const value = useMemo<PlayerContextValue>(
    () => ({
      queue,
      order,
      position,
      current,
      loadedTrackId,
      isPlaying,
      isLoading,
      currentTime,
      duration,
      volume,
      muted,
      shuffle,
      repeat,
      error,
      playTracks,
      playNow,
      playAt,
      toggle,
      pause,
      next,
      previous,
      seek,
      skipBy,
      getPosition,
      setVolume,
      toggleMute: () => setMuted((value) => !value),
      toggleShuffle,
      cycleRepeat,
      jumpTo,
      enqueue,
      removeAt,
      clearQueue,
    }),
    [
      clearQueue,
      current,
      currentTime,
      cycleRepeat,
      duration,
      enqueue,
      error,
      getPosition,
      isLoading,
      isPlaying,
      jumpTo,
      loadedTrackId,
      muted,
      next,
      order,
      pause,
      playAt,
      playNow,
      playTracks,
      position,
      previous,
      queue,
      removeAt,
      repeat,
      seek,
      setVolume,
      shuffle,
      skipBy,
      toggle,
      toggleShuffle,
      volume,
    ],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): PlayerContextValue {
  const context = useContext(PlayerContext);
  if (!context) throw new Error('usePlayer must be used inside <PlayerProvider>');
  return context;
}
