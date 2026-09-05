import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { api, presence } from '../lib/api';
import { apiUrl } from '../lib/config';
import type { NowPlayingInput } from '../lib/api';
import { useAuth } from './AuthContext';
import { usePlayer } from './PlayerContext';
import type { NowPlaying, PartyState, Track } from '../lib/types';

/**
 * "Listening now" and listen-along.
 *
 * One heartbeat carries both. While a track is loaded the client PUTs its
 * state; the server stores it as this account's status and, when they happen
 * to be hosting a session, as the state their guests follow. Guests poll the
 * session and steer their own player at it.
 *
 * Everything is polled rather than pushed. A websocket dies whenever iOS
 * backgrounds the tab and comes back needing a reconnect dance; a request
 * every few seconds against a primary key does not, and it recovers from a
 * dropped network by simply working again on the next tick.
 */

/** Heartbeat while nobody is following: often enough to look live. */
const IDLE_BEAT_MS = 20_000;
/** Heartbeat while hosting: the guests' sync is only as fresh as this. */
const HOST_BEAT_MS = 5_000;
/** How often a guest asks where the host is. */
const FOLLOW_POLL_MS = 4_000;
/** Drift a guest tolerates before seeking; below this, seeking is worse. */
const DRIFT_TOLERANCE_S = 2.5;

interface PresenceContextValue {
  /** The session this account hosts or follows, or null. */
  party: PartyState | null;
  /** True when following someone else's session rather than hosting. */
  isFollowing: boolean;
  isHosting: boolean;
  /** Set while a guest has paused locally and stopped tracking the host. */
  outOfSync: boolean;
  error: string | null;

  /** Starts listening along with someone, from their profile. */
  listenAlongWith: (userId: string) => Promise<void>;
  leaveParty: () => Promise<void>;
  /** Snaps back to the host after a local pause. */
  resync: () => void;
  refreshParty: () => void;
}

const PresenceContext = createContext<PresenceContextValue | null>(null);

/**
 * A stand-in Track built from a status snapshot.
 *
 * A guest is handed the id and the labels, not a library record. We fetch the
 * real one where we can; this keeps the player usable when we cannot — after a
 * rescan renamed the file, say. Only the fields the player bar reads are
 * meaningful, and the rest are honest placeholders rather than invented data.
 */
function placeholderTrack(now: NowPlaying): Track {
  return {
    id: now.trackId,
    path: '',
    title: now.title,
    artist: now.artist,
    artistId: '',
    albumArtist: now.artist,
    album: now.album ?? '',
    albumId: now.albumId ?? '',
    trackNo: null,
    discNo: null,
    year: null,
    genres: [],
    duration: now.duration,
    bitrate: null,
    sampleRate: null,
    bitsPerSample: null,
    channels: null,
    codec: null,
    container: null,
    lossless: false,
    ext: '',
    size: 0,
    mtimeMs: 0,
    hasEmbeddedCover: false,
    coverId: now.coverId,
  };
}

export function PresenceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const player = usePlayer();
  const { current, loadedTrackId, isPlaying, currentTime, getPosition, playAt, seek, pause, toggle } =
    player;

  const [party, setParty] = useState<PartyState | null>(null);
  const [outOfSync, setOutOfSync] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Live values for the timers.
   *
   * The heartbeat and the follow loop run on intervals, and rebuilding those
   * intervals every time the play position ticks would restart them several
   * times a second. They read the current state through refs instead.
   */
  const stateRef = useRef({ current, loadedTrackId, isPlaying, currentTime });
  stateRef.current = { current, loadedTrackId, isPlaying, currentTime };

  const partyRef = useRef<PartyState | null>(null);
  partyRef.current = party;

  const isHosting = Boolean(party?.isHost && party.live);
  const isFollowing = Boolean(party && !party.isHost && party.live);

  /** Guards the follow loop while a track is being fetched and loaded. */
  const applyingRef = useRef(false);
  /**
   * The track the follow loop put on, or the one the guest already had when
   * they joined. Anything else appearing in the player is the guest choosing
   * their own music, which ends the session for them.
   */
  const allowedTrackRef = useRef<string | null>(null);

  // --- heartbeat ---------------------------------------------------------

  const beat = useCallback(async () => {
    const { current: track, loadedTrackId: loaded, isPlaying: playing } = stateRef.current;

    /*
     * Only report a track the element is actually pointed at, and take its
     * position from the element rather than from React state.
     *
     * `current` flips the moment the queue moves on, an effect before the
     * element is re-pointed and before `currentTime` resets. Reading the pair
     * from different places published the new track's id beside the previous
     * track's position — which landed every guest three minutes into a song
     * that had just started.
     */
    const payload: NowPlayingInput | null =
      track && loaded === track.id
        ? {
            trackId: track.id,
            title: track.title,
            artist: track.artist,
            album: track.album || null,
            albumId: track.albumId || null,
            coverId: track.coverId,
            duration: track.duration,
            position: getPosition(),
            isPlaying: playing,
          }
        : null;

    try {
      const result = await presence.heartbeat(payload);
      // The host's own view of the room comes back with the beat, so the
      // listener list stays live without a second request.
      if (result.party) setParty(result.party);
    } catch {
      // A missed beat is not worth surfacing: the next one fixes it, and the
      // status expiring on its own is the correct outcome if they keep failing.
    }
  }, [getPosition]);

  // Report immediately whenever the track, or whether it is running, changes —
  // that is what makes a skip or a pause show up for friends at once.
  useEffect(() => {
    if (!user) return;
    void beat();
  }, [beat, user, loadedTrackId, isPlaying]);

  useEffect(() => {
    if (!user) return;
    const period = isHosting ? HOST_BEAT_MS : IDLE_BEAT_MS;
    const timer = window.setInterval(() => void beat(), period);
    return () => window.clearInterval(timer);
  }, [beat, isHosting, user]);

  /**
   * Closing the tab retracts the status straight away.
   *
   * `keepalive` lets the request outlive the page, and unlike sendBeacon it
   * still carries the CSRF marker and the session cookie, so it goes through
   * the same guarded endpoint as every other beat. If it doesn't make it, the
   * status expires by itself a minute later.
   */
  useEffect(() => {
    if (!user) return;
    const retract = () => {
      try {
        void fetch(apiUrl('/api/presence'), {
          method: 'PUT',
          credentials: 'include',
          keepalive: true,
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'boozie-archive',
          },
          body: JSON.stringify({ now: null }),
        });
      } catch {
        // Expiry covers it.
      }
    };
    window.addEventListener('pagehide', retract);
    return () => window.removeEventListener('pagehide', retract);
  }, [user]);

  // --- party membership --------------------------------------------------

  const refreshParty = useCallback(async () => {
    if (!user) return;
    try {
      const result = await presence.currentParty();
      setParty(result.party);
    } catch {
      // Leave the last known state in place rather than flickering the UI.
    }
  }, [user]);

  // Restore an in-progress session after a reload.
  useEffect(() => {
    if (!user) {
      setParty(null);
      return;
    }
    void refreshParty();
  }, [refreshParty, user]);

  const listenAlongWith = useCallback(
    async (userId: string) => {
      setError(null);
      try {
        const result = await presence.listenAlongWith(userId);
        setParty(result.party);
        setOutOfSync(false);
      } catch (joinError) {
        setError(
          joinError instanceof Error ? joinError.message : 'Could not start listening along.',
        );
        throw joinError;
      }
    },
    [],
  );

  const leaveParty = useCallback(async () => {
    const active = partyRef.current;
    if (!active) return;
    setParty(null);
    setOutOfSync(false);
    try {
      await presence.leaveParty(active.id);
    } catch {
      // Already gone server-side is the same outcome we just applied locally.
    }
  }, []);

  // --- following ---------------------------------------------------------

  /** Where the host is right now, allowing for the age of the snapshot. */
  const hostPosition = useCallback((state: PartyState): number => {
    if (!state.now) return 0;
    if (!state.now.isPlaying) return state.now.position;
    const sampledAt = Date.parse(state.positionAt);
    const answeredAt = Date.parse(state.serverTime);
    if (!Number.isFinite(sampledAt) || !Number.isFinite(answeredAt)) return state.now.position;
    // Both timestamps come from the server's clock, so the gap between them is
    // real elapsed time and does not depend on this device being set correctly.
    const elapsed = Math.max(0, (answeredAt - sampledAt) / 1000);
    return state.now.position + elapsed;
  }, []);

  const applyPartyState = useCallback(
    async (state: PartyState) => {
      if (applyingRef.current) return;
      const now = state.now;
      if (!now) return;

      const target = hostPosition(state);
      const playing = stateRef.current.current;

      // Different track: load the host's and start where they are.
      if (playing?.id !== now.trackId) {
        applyingRef.current = true;
        try {
          // Prefer the real library record so the queue panel, the download
          // button and the track details are all correct for the guest too.
          let track: Track;
          try {
            track = (await api.track(now.trackId)).track;
          } catch {
            track = placeholderTrack(now);
          }
          allowedTrackRef.current = now.trackId;
          playAt(track, target, now.isPlaying);
        } finally {
          applyingRef.current = false;
        }
        return;
      }

      // Same track: correct drift, and match the host's play/pause.
      allowedTrackRef.current = now.trackId;
      if (now.isPlaying) {
        // Element truth again: `currentTime` state only ticks on timeupdate.
        if (Math.abs(getPosition() - target) > DRIFT_TOLERANCE_S) seek(target);
        if (!stateRef.current.isPlaying) toggle();
      } else if (stateRef.current.isPlaying) {
        pause();
      }
    },
    [getPosition, hostPosition, pause, playAt, seek, toggle],
  );

  useEffect(() => {
    if (!isFollowing || !party) return;

    let cancelled = false;

    async function tick() {
      try {
        const result = await presence.party(party!.id);
        if (cancelled) return;
        setParty(result.party);

        if (!result.party.live) {
          // The host ended it (or went away): stop following, keep playing.
          setParty(null);
          return;
        }
        // A guest who paused on purpose is left alone until they resync.
        if (!outOfSync) await applyPartyState(result.party);
      } catch {
        // Transient failure — try again on the next tick.
      }
    }

    void tick();
    const timer = window.setInterval(() => void tick(), FOLLOW_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [applyPartyState, isFollowing, outOfSync, party?.id]);

  /**
   * A guest pausing means "hold on a second", not "leave".
   *
   * Once they pause, syncing stops so the host's stream doesn't wrench the
   * track back out from under them; pressing play snaps them to where the host
   * has got to in the meantime.
   *
   * The delay matters: swapping the element's src reports paused for a moment
   * before playback starts, and treating that as a deliberate pause would drop
   * every guest out of sync on the host's first track change.
   */
  useEffect(() => {
    if (!isFollowing || !party?.now?.isPlaying) return;
    if (isPlaying) {
      setOutOfSync(false);
      return;
    }
    if (player.isLoading || current?.id !== party.now.trackId) return;
    const timer = window.setTimeout(() => setOutOfSync(true), 1500);
    return () => window.clearTimeout(timer);
  }, [current?.id, isFollowing, isPlaying, party?.now?.isPlaying, party?.now?.trackId, player.isLoading]);

  /**
   * Whatever is loaded when following starts is tolerated.
   *
   * Both entry points need this — pressing the button, and restoring a session
   * on a page reload. Without it the auto-disconnect below reads the track the
   * guest already had (or the one the player just restored from the last
   * visit) as a deliberate choice, and drops them the instant they arrive.
   * Declared above that effect so the baseline is set before it is checked.
   */
  const wasFollowingRef = useRef(false);
  useEffect(() => {
    if (isFollowing && !wasFollowingRef.current) {
      allowedTrackRef.current = stateRef.current.loadedTrackId;
    }
    wasFollowingRef.current = isFollowing;
  }, [isFollowing]);

  /**
   * Playing your own music leaves the session.
   *
   * Following means somebody else is driving your player, so choosing a track
   * is a statement that you would rather drive it yourself. Anything the follow
   * loop loaded is recorded first, so the host's own skips never trip this —
   * only a track that appeared because the guest picked it.
   */
  useEffect(() => {
    if (!isFollowing || !loadedTrackId) return;
    if (loadedTrackId === allowedTrackRef.current) return;
    void leaveParty();
  }, [isFollowing, leaveParty, loadedTrackId]);

  const resync = useCallback(() => {
    setOutOfSync(false);
    const active = partyRef.current;
    if (active?.live) void applyPartyState(active);
  }, [applyPartyState]);

  const value = useMemo<PresenceContextValue>(
    () => ({
      party,
      isFollowing,
      isHosting,
      outOfSync,
      error,
      listenAlongWith,
      leaveParty,
      resync,
      refreshParty: () => void refreshParty(),
    }),
    [
      error,
      isFollowing,
      isHosting,
      leaveParty,
      listenAlongWith,
      outOfSync,
      party,
      refreshParty,
      resync,
    ],
  );

  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

export function usePresence(): PresenceContextValue {
  const context = useContext(PresenceContext);
  if (!context) throw new Error('usePresence must be used inside <PresenceProvider>');
  return context;
}
