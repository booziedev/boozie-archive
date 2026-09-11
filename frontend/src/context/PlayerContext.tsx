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

import { history, mediaUrl } from '../lib/api';
import {
  applyEq,
  applyReplayGain,
  attachAnalyser,
  createAudioGraph,
  fadeDeck,
  resumeGraph,
  setDeckLevel,
  type AudioGraph,
} from '../lib/audioGraph';
import {
  DEFAULT_AUDIO_SETTINGS,
  readAudioSettings,
  writeAudioSettings,
  type AudioSettings,
} from '../lib/audioSettings';
import { mediaCrossOrigin } from '../lib/config';
import { isRadio } from '../lib/radio';
import { useAuth } from './AuthContext';
import type { Track } from '../lib/types';

/**
 * Audio playback.
 *
 * Design notes for iOS Safari (including the installed home-screen app):
 *  - exactly TWO <audio> elements exist for the lifetime of the app and their
 *    `src` is swapped between tracks. Creating a fresh element per track breaks
 *    playback, because only an element "unlocked" by a user gesture may play —
 *    which is also why both are unlocked together on the first gesture, rather
 *    than the second one being made when a crossfade first needs it. One deck
 *    is active at a time; the other holds the next track, ready to start;
 *  - `play()` is always reached synchronously from the click handler chain;
 *  - the Media Session API drives the lock screen / control centre widget,
 *    which is what makes the installed PWA feel like a native player;
 *  - seeking relies on the backend answering HTTP range requests with 206.
 *
 * Queue, play order and position live in a single state object so that a
 * shuffle toggle or an enqueue is one atomic update rather than three setters
 * racing each other.
 */

/**
 * When a play counts as a listen, following the scrobbling convention: four
 * minutes, or half the track, whichever comes first.
 */
const SCROBBLE_MS = 4 * 60 * 1000;
const SCROBBLE_FRACTION = 0.5;
/**
 * The largest timeupdate gap treated as continuous playback.
 *
 * Listening time is accumulated from the deltas between timeupdate events, not
 * read off the playhead: seeking to the last thirty seconds of a track is not
 * listening to it. Real events arrive about four times a second, so anything
 * this far apart is a seek and is not counted.
 */
const CONTINUOUS_GAP_MS = 2_000;

/**
 * Whether an element is already pointed at a URL.
 *
 * `element.src` reports the *resolved* absolute URL, while the media URLs are
 * built as same-origin paths — comparing the two directly never matches, which
 * silently turns every "already loaded" check into a reload.
 */
function holds(element: HTMLAudioElement, url: string): boolean {
  if (!element.getAttribute('src')) return false;
  try {
    return element.src === new URL(url, window.location.href).href;
  } catch {
    return element.src === url;
  }
}

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

  /** Per-device playback settings: EQ, levelling, speed. */
  audio: AudioSettings;
  setAudio: (patch: Partial<AudioSettings>) => void;
  /**
   * True when the graph is actually in the path. False means the browser
   * refused it or the setting is off, and the EQ controls have nothing to
   * drive — the UI says so rather than pretending to work.
   */
  audioGraphReady: boolean;
  /** An analyser tapped off the end of the chain, for level meters. */
  getAnalyser: () => AnalyserNode | null;
  /** Stop playback after this many minutes; null cancels. */
  sleepTimerMinutes: number | null;
  setSleepTimer: (minutes: number | null) => void;
  /** Milliseconds left on the sleep timer, or null when it isn't running. */
  sleepRemainingMs: number | null;
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
  /** Both decks. `audioRef` always points at whichever one is audible. */
  const decksRef = useRef<HTMLAudioElement[]>([]);
  const activeDeckRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** Set while a handover between decks is in flight. */
  const crossfadingRef = useRef(false);
  const crossfadeTimerRef = useRef<number | null>(null);
  /** Both elements are unlocked together, once, inside the first gesture. */
  const unlockedRef = useRef(false);
  const restored = useRef(false);
  /** Set when playback should start as soon as the new src is ready. */
  const autoplayRef = useRef(false);
  /** Position to restore into the element once metadata for it has loaded. */
  const resumeTimeRef = useRef(0);

  const { user } = useAuth();

  /**
   * Scrobble bookkeeping for the track currently loaded. All three reset when
   * the element is pointed at something new.
   */
  const currentRef = useRef<Track | null>(null);
  const listenedMsRef = useRef(0);
  const lastPositionRef = useRef(0);
  const loggedRef = useRef(false);

  const graphRef = useRef<AudioGraph | null>(null);
  const [audioGraphReady, setAudioGraphReady] = useState(false);
  const [audio, setAudioState] = useState<AudioSettings>(DEFAULT_AUDIO_SETTINGS);

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

  currentRef.current = current;

  // Two audio elements for the whole app lifetime.
  if (decksRef.current.length === 0 && typeof window !== 'undefined') {
    const crossOrigin = mediaCrossOrigin();
    decksRef.current = [0, 1].map(() => {
      const element = new Audio();
      element.preload = 'metadata';
      // Only set when the API is cross-origin: the attribute makes the browser
      // send the session cookie, but demands CORS headers in return.
      if (crossOrigin) element.crossOrigin = crossOrigin;
      return element;
    });
    audioRef.current = decksRef.current[0]!;
  }

  /** The deck that is not currently audible — where the next track waits. */
  const idleDeck = useCallback(() => decksRef.current[1 - activeDeckRef.current]!, []);

  /**
   * Build the graph once, on the first render that has both the element and
   * the stored settings.
   *
   * Deliberately not conditional on the EQ being switched on: routing an
   * element through a graph is irreversible, so the choice has to be made once
   * and stuck to. Turning the EQ off flattens the filters; turning the graph
   * off entirely takes a reload, which is what the setting says it does.
   */
  useEffect(() => {
    if (decksRef.current.length === 0) return;

    const stored = readAudioSettings();
    setAudioState(stored);
    if (!stored.enabled) {
      // No graph: the idle deck is silenced with its own volume instead.
      decksRef.current.forEach((element, index) => {
        element.volume = index === 0 ? readVolume() : 0;
      });
      return;
    }

    const graph = createAudioGraph(decksRef.current);
    graphRef.current = graph;
    setAudioGraphReady(Boolean(graph));
    if (!graph) {
      decksRef.current.forEach((element, index) => {
        element.volume = index === 0 ? readVolume() : 0;
      });
    }
  }, []);

  /**
   * Levelling for the track now playing.
   *
   * Album mode falls back to the track value when a release wasn't scanned as
   * an album, which is the common case for anything ripped a track at a time.
   */
  useEffect(() => {
    if (audio.replayGain === 'off' || !current) {
      applyReplayGain(graphRef.current, activeDeckRef.current, undefined, undefined, 0);
      return;
    }
    const tags = current.replayGain;
    const gainDb =
      audio.replayGain === 'album'
        ? (tags?.albumGainDb ?? tags?.trackGainDb)
        : tags?.trackGainDb;
    applyReplayGain(
      graphRef.current,
      activeDeckRef.current,
      gainDb,
      tags?.trackPeak,
      audio.replayGainPreampDb,
    );
  }, [audio.replayGain, audio.replayGainPreampDb, current]);

  /** Push the curve whenever it changes, and whenever the EQ is toggled. */
  useEffect(() => {
    applyEq(graphRef.current, audio.eqOn ? audio.gains : [], audio.eqOn ? audio.preampDb : 0);
  }, [audio.eqOn, audio.gains, audio.preampDb]);

  const setAudio = useCallback((patch: Partial<AudioSettings>) => {
    setAudioState((previous) => {
      const next = { ...previous, ...patch };
      writeAudioSettings(next);
      return next;
    });
  }, []);

  const getAnalyser = useCallback(() => attachAnalyser(graphRef.current), []);

  // --- sleep timer -------------------------------------------------------

  const [sleepUntil, setSleepUntil] = useState<number | null>(null);
  const [sleepRemainingMs, setSleepRemainingMs] = useState<number | null>(null);

  const setSleepTimer = useCallback((minutes: number | null) => {
    setSleepUntil(minutes === null ? null : Date.now() + minutes * 60_000);
  }, []);

  /**
   * Counts down and pauses when it reaches zero.
   *
   * It pauses rather than clearing the queue, so picking the music back up is
   * one tap — the point is to fall asleep to it, not to lose your place.
   */
  useEffect(() => {
    if (sleepUntil === null) {
      setSleepRemainingMs(null);
      return;
    }

    const tick = () => {
      const remaining = sleepUntil - Date.now();
      if (remaining <= 0) {
        audioRef.current?.pause();
        setSleepUntil(null);
        setSleepRemainingMs(null);
        return;
      }
      setSleepRemainingMs(remaining);
    };

    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [sleepUntil]);

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

  /**
   * Reports the current track as listened to, at most once per playthrough.
   *
   * Called from the timeupdate handler once enough continuous playback has
   * accumulated, and again on `ended` for anything short enough that the
   * threshold and the end of the track arrive together.
   */
  const resetScrobble = useCallback(() => {
    listenedMsRef.current = 0;
    lastPositionRef.current = 0;
    loggedRef.current = false;
  }, []);

  const logPlay = useCallback(
    (track: Track | null, completed: boolean) => {
      if (!track || !user || loggedRef.current) return;
      /*
       * Radio is never logged.
       *
       * A station plays for hours and has no duration, so it would swamp every
       * count built on the log — top played, the recap and the wrapped
       * lists. The server refuses an `rd_` id as well; this just saves the
       * round trip.
       */
      if (isRadio(track)) return;
      loggedRef.current = true;
      void history
        .record({
          trackId: track.id,
          title: track.title,
          artist: track.artist,
          album: track.album || null,
          albumId: track.albumId || null,
          msPlayed: Math.round(listenedMsRef.current),
          completed,
        })
        .catch(() => {
          // A lost scrobble is not worth interrupting playback for, and the
          // next track will report normally.
        });
    },
    [user],
  );

  // --- decks: crossfade and gapless --------------------------------------

  /**
   * What plays after the current track, and where it sits in the order.
   *
   * Kept in a ref because the element's own event handlers need it, and those
   * are bound once — reading it from React state there would hand them a
   * snapshot from whenever the listeners were last attached.
   */
  const nextUpRef = useRef<{ track: Track; position: number } | null>(null);
  /** The live settings, for the same reason. */
  const audioSettingsRef = useRef(audio);
  audioSettingsRef.current = audio;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  useEffect(() => {
    // Repeat-one loops the same file on the same deck, so there is nothing to
    // hand over to; the end of a queue that does not repeat has nothing next.
    if (repeat === 'one' || order.length === 0) {
      nextUpRef.current = null;
      return;
    }
    const nextPosition = position + 1 < order.length ? position + 1 : repeat === 'all' ? 0 : -1;
    const index = nextPosition === -1 ? undefined : order[nextPosition];
    const track = index === undefined ? undefined : queue[index];
    nextUpRef.current = track ? { track, position: nextPosition } : null;
  }, [order, position, queue, repeat]);

  /**
   * Ends a handover: the outgoing deck stops and gives up its buffer.
   *
   * Safe to call at any point, including when no handover is running — every
   * transport action does, because a fade that outlives the track it was
   * fading is worse than no fade.
   */
  /** Lets callers declared before it reach the canceller. */
  const finishHandoverRef = useRef<() => void>(() => undefined);

  const finishHandover = useCallback(() => {
    if (crossfadeTimerRef.current !== null) {
      window.clearTimeout(crossfadeTimerRef.current);
      crossfadeTimerRef.current = null;
    }
    if (!crossfadingRef.current) return;
    crossfadingRef.current = false;

    const outgoing = idleDeck();
    const graph = graphRef.current;
    outgoing.pause();
    outgoing.removeAttribute('src');
    outgoing.load();
    setDeckLevel(graph, 1 - activeDeckRef.current, outgoing, 0, volumeRef.current);
    setDeckLevel(graph, activeDeckRef.current, audioRef.current!, 1, volumeRef.current);
  }, [idleDeck]);

  finishHandoverRef.current = finishHandover;

  /**
   * Hands playback over to the deck holding the next track.
   *
   * `seconds` is the overlap: zero is the gapless case, where the next track
   * starts the instant this one ends. The queue position moves at the same
   * moment, so everything downstream — the status heartbeat, the queue
   * highlight, the scrobble — follows the deck that is now audible.
   */
  const startHandover = useCallback(
    (seconds: number) => {
      const upcoming = nextUpRef.current;
      const incoming = idleDeck();
      const outgoing = audioRef.current;
      if (!upcoming || !outgoing || crossfadingRef.current) return false;
      // Only if the deck really is holding the right track, ready to play.
      if (!holds(incoming, mediaUrl.stream(upcoming.track.id)) || incoming.readyState < 3) {
        return false;
      }

      const graph = graphRef.current;
      const settings = audioSettingsRef.current;
      const incomingDeck = 1 - activeDeckRef.current;

      // The track being faded out has been heard; log it before the handover
      // moves `current`, and stop its own `ended` from reporting it twice.
      logPlay(currentRef.current, true);

      // Levelling for the incoming track, before a sample of it is audible.
      const tags = upcoming.track.replayGain;
      applyReplayGain(
        graph,
        incomingDeck,
        settings.replayGain === 'off'
          ? undefined
          : settings.replayGain === 'album'
            ? (tags?.albumGainDb ?? tags?.trackGainDb)
            : tags?.trackGainDb,
        tags?.trackPeak,
        settings.replayGainPreampDb,
      );

      crossfadingRef.current = true;
      incoming.currentTime = 0;
      incoming.playbackRate = settings.playbackRate;
      incoming.muted = outgoing.muted;
      if (!graph) incoming.volume = 0;
      void incoming.play().catch(() => {
        // Refused (no gesture yet, or the format is unplayable here): fall
        // back to the ordinary path rather than leaving both decks silent.
        crossfadingRef.current = false;
      });

      fadeDeck(graph, activeDeckRef.current, outgoing, 0, seconds, volumeRef.current);
      fadeDeck(graph, incomingDeck, incoming, 1, seconds, volumeRef.current);

      // The incoming deck is the audible one from here on.
      activeDeckRef.current = incomingDeck;
      audioRef.current = incoming;
      setDuration(Number.isFinite(incoming.duration) ? incoming.duration : (upcoming.track.duration ?? 0));
      setCurrentTime(incoming.currentTime);

      autoplayRef.current = true;
      resumeTimeRef.current = 0;
      setPlayback((state) => ({ ...state, position: upcoming.position }));

      crossfadeTimerRef.current = window.setTimeout(
        () => finishHandover(),
        Math.max(0, seconds) * 1000 + 250,
      );
      return true;
    },
    [finishHandover, idleDeck, logPlay],
  );

  const startElement = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    // The context starts suspended and may only be resumed from a user
    // gesture; this runs inside the click chain that reaches play().
    resumeGraph(graphRef.current);

    /*
     * Unlock the other deck on the same gesture.
     *
     * iOS only lets an element play if a user gesture started it at least
     * once. A crossfade may be minutes away by the time it needs the second
     * deck, long after any gesture — so it is started and stopped here, while
     * a gesture is still on the stack.
     */
    if (!unlockedRef.current) {
      unlockedRef.current = true;
      const other = idleDeck();
      const promise = other.play();
      if (promise) {
        promise
          .then(() => other.pause())
          .catch(() => {
            // Nothing loaded yet, or refused; the ordinary path still works.
          });
      }
    }

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
  }, [idleDeck]);

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
      resetScrobble();
      return;
    }

    const url = mediaUrl.stream(current.id);
    if (holds(audio, url)) {
      setLoadedTrackId(current.id);
      // Re-selecting the same track is a new playthrough, and counts again.
      resetScrobble();
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
    resetScrobble();
    if (autoplayRef.current) startElement();
  }, [current, resetScrobble, startElement]);

  // --- transport ---------------------------------------------------------

  const goTo = useCallback(
    (nextPosition: number, autoplay: boolean) => {
      // Whatever was fading is now beside the point.
      finishHandover();
      autoplayRef.current = autoplay;
      resumeTimeRef.current = 0;
      setPlayback((state) => {
        if (nextPosition < 0 || nextPosition >= state.order.length) return state;
        return { ...state, position: nextPosition };
      });
    },
    [finishHandover],
  );

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
      logPlay(currentRef.current, true);
      audio.currentTime = 0;
      void audio.play();
      return;
    }

    /*
     * Gapless: the next track is already buffered on the other deck, so start
     * it here rather than going round through the load effect, which would
     * point this element at a new URL and wait for it. `startHandover` reports
     * the finished play itself.
     */
    if (audioSettingsRef.current.gaplessOn && startHandover(0)) return;

    // A track short enough that the threshold and the end arrive together
    // still counts; logPlay is a no-op if timeupdate already reported it.
    logPlay(currentRef.current, true);
    next();
  }, [logPlay, next, repeat, startHandover]);

  // --- audio element events ----------------------------------------------

  /**
   * Bound to both decks, not just the active one.
   *
   * Every handler ignores the deck that is not audible: while a crossfade is
   * running the outgoing track is still firing timeupdate and will fire
   * `ended`, and none of that should touch the playhead, the scrobble or the
   * queue — that track has already been reported and moved on from.
   */
  useEffect(() => {
    const decks = decksRef.current;
    if (decks.length === 0) return;

    const detachers = decks.map((audio) => {
      const isActive = () => audioRef.current === audio;

      const onPlay = () => {
        if (isActive()) setIsPlaying(true);
      };
      const onPause = () => {
        if (isActive()) setIsPlaying(false);
      };
      const onWaiting = () => {
        if (isActive()) setIsLoading(true);
      };
      const onPlaying = () => {
        if (!isActive()) return;
        setIsLoading(false);
        setError(null);
      };

      const onTimeUpdate = () => {
        if (!isActive()) return;
        setCurrentTime(audio.currentTime);

        /*
         * Accumulate real listening time, not playhead position.
         *
         * timeupdate fires a few times a second during playback, so a small
         * forward delta is genuine listening. Anything larger is a seek, and
         * skipping to the last thirty seconds of a track should not count as
         * having heard it.
         */
        const delta = (audio.currentTime - lastPositionRef.current) * 1000;
        lastPositionRef.current = audio.currentTime;
        if (delta > 0 && delta < CONTINUOUS_GAP_MS) listenedMsRef.current += delta;

        const duration = Number.isFinite(audio.duration) ? audio.duration : 0;

        /*
         * Crossfade: begin the overlap while this track still has that much
         * left to play. The next deck has to be genuinely ready — if it is
         * still buffering, this does nothing and the track ends normally,
         * which is the right way to fail.
         */
        const overlap = audioSettingsRef.current.crossfadeSeconds;
        if (overlap > 0 && duration > 0 && !crossfadingRef.current && !audio.paused) {
          const remaining = duration - audio.currentTime;
          if (remaining > 0 && remaining <= overlap) startHandover(Math.min(overlap, remaining));
        }

        if (loggedRef.current) return;
        const threshold = duration > 0
          ? Math.min(SCROBBLE_MS, duration * 1000 * SCROBBLE_FRACTION)
          : SCROBBLE_MS;
        if (listenedMsRef.current >= threshold) logPlay(currentRef.current, false);
      };

      const onLoadedMetadata = () => {
        if (!isActive()) return;
        setIsLoading(false);
        if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
        // Restore the position saved from the previous visit, once.
        if (resumeTimeRef.current > 0) {
          audio.currentTime = Math.min(resumeTimeRef.current, audio.duration || 0);
          resumeTimeRef.current = 0;
        }
      };

      const onError = () => {
        if (!isActive()) {
          // The deck holding the next track cannot play it. Give up on the
          // handover quietly; the ordinary load path will report it properly
          // when the track's turn comes.
          audio.removeAttribute('src');
          return;
        }
        setIsLoading(false);
        setIsPlaying(false);
        setError('Playback failed — the file may be missing on the server or unsupported here.');
      };

      const onEnded = () => {
        // The outgoing side of a crossfade reaching its end is expected, and
        // has already been dealt with.
        if (!isActive()) return;
        handleEnded();
      };

      audio.addEventListener('play', onPlay);
      audio.addEventListener('pause', onPause);
      audio.addEventListener('waiting', onWaiting);
      audio.addEventListener('playing', onPlaying);
      audio.addEventListener('timeupdate', onTimeUpdate);
      audio.addEventListener('loadedmetadata', onLoadedMetadata);
      audio.addEventListener('durationchange', onLoadedMetadata);
      audio.addEventListener('error', onError);
      audio.addEventListener('ended', onEnded);

      return () => {
        audio.removeEventListener('play', onPlay);
        audio.removeEventListener('pause', onPause);
        audio.removeEventListener('waiting', onWaiting);
        audio.removeEventListener('playing', onPlaying);
        audio.removeEventListener('timeupdate', onTimeUpdate);
        audio.removeEventListener('loadedmetadata', onLoadedMetadata);
        audio.removeEventListener('durationchange', onLoadedMetadata);
        audio.removeEventListener('error', onError);
        audio.removeEventListener('ended', onEnded);
      };
    });

    return () => detachers.forEach((detach) => detach());
  }, [handleEnded, logPlay, startHandover]);

  useEffect(() => {
    const element = audioRef.current;
    if (element) element.playbackRate = audio.playbackRate;
  }, [audio.playbackRate, loadedTrackId]);

  /** Nothing outlives the page: stop a fade in flight on unmount. */
  useEffect(() => () => finishHandover(), [finishHandover]);

  useEffect(() => {
    for (const element of decksRef.current) {
      element.muted = muted;
      // With the graph in place the fade rides a gain node, so both decks sit
      // at the slider's level. Without one the fade *is* the element volume,
      // and only the audible deck may carry it.
      if (graphRef.current) element.volume = volume;
      else if (!crossfadingRef.current) element.volume = element === audioRef.current ? volume : 0;
    }
    try {
      localStorage.setItem(VOLUME_KEY, String(volume));
    } catch {
      // Non-fatal.
    }
  }, [volume, muted]);

  /**
   * Keeps the idle deck loaded with whatever comes next.
   *
   * This is what makes both gapless and crossfade possible: by the time the
   * current track runs out, the next one is decoded and one `play()` away.
   * Nothing is preloaded when both are switched off, so the default costs no
   * extra bandwidth.
   */
  useEffect(() => {
    if (crossfadingRef.current) return;
    const idle = decksRef.current[1 - activeDeckRef.current];
    if (!idle) return;

    const wanted = audio.gaplessOn || audio.crossfadeSeconds > 0 ? nextUpRef.current : null;
    if (!wanted) {
      if (idle.getAttribute('src')) {
        idle.removeAttribute('src');
        idle.load();
      }
      return;
    }

    const url = mediaUrl.stream(wanted.track.id);
    if (holds(idle, url)) return;
    idle.preload = 'auto';
    idle.src = url;
    idle.load();
  }, [audio.gaplessOn, audio.crossfadeSeconds, current, order, position, queue, repeat]);

  const playTracks = useCallback(
    (tracks: Track[], startIndex = 0) => {
      if (tracks.length === 0) return;
      const safeStart = Math.min(Math.max(0, startIndex), tracks.length - 1);
      const indices = tracks.map((_, index) => index);
      const nextOrder = shuffle
        ? [safeStart, ...shuffled(indices.filter((index) => index !== safeStart))]
        : indices;
      const nextPosition = shuffle ? 0 : safeStart;

      finishHandover();
      autoplayRef.current = true;
      resumeTimeRef.current = 0;
      setPlayback({ queue: tracks, order: nextOrder, position: nextPosition });

      // When the very same track is already loaded, `current` does not change,
      // so the load effect won't fire — start playback here instead. This also
      // keeps the call inside the user's click gesture, which iOS requires.
      if (current?.id === tracks[safeStart]?.id) startElement();
    },
    [current?.id, finishHandover, shuffle, startElement],
  );

  const playNow = useCallback((track: Track) => playTracks([track], 0), [playTracks]);

  const playAt = useCallback(
    (track: Track, seconds: number, autoplay = true) => {
      const target = Math.max(0, seconds);
      finishHandover();
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
    [current?.id, finishHandover, startElement],
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
    // Seeking back out of the overlap must not leave the outgoing track
    // playing underneath.
    finishHandoverRef.current();
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
    finishHandover();
    audioRef.current?.pause();
    setPlayback(EMPTY_PLAYBACK);
    setIsPlaying(false);
  }, [finishHandover]);

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
      audio,
      setAudio,
      audioGraphReady,
      getAnalyser,
      sleepTimerMinutes: sleepUntil === null ? null : Math.ceil((sleepUntil - Date.now()) / 60_000),
      setSleepTimer,
      sleepRemainingMs,
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
      audio,
      audioGraphReady,
      enqueue,
      error,
      getAnalyser,
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
      setAudio,
      setSleepTimer,
      setVolume,
      shuffle,
      skipBy,
      sleepRemainingMs,
      sleepUntil,
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
