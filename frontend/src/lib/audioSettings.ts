/**
 * Playback settings that belong to the device, not the account.
 *
 * A crossfade length is a property of how you listen, and a playback speed is
 * a property of what you are listening to. Syncing them to the server would
 * mean the speed you set for a podcast on the train following you onto your
 * desk speakers, so they live in localStorage and stay where they were made.
 *
 * There were six more of these once, for an equaliser and loudness levelling.
 * Both needed a Web Audio graph, and that graph silenced playback on iOS
 * outright, so it and they were removed rather than left behind a switch
 * somebody would have to know to find.
 */

const KEY = 'boozie.audio.v1';

export interface AudioSettings {
  /** Seconds of overlap between tracks; 0 is a hard cut. */
  crossfadeSeconds: number;
  /**
   * Start the next track the instant this one ends, from a deck that already
   * has it buffered. Costs one track of preloading; worth it on anything mixed
   * or recorded live, where the silence between tracks is the artefact.
   */
  gaplessOn: boolean;
  playbackRate: number;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  crossfadeSeconds: 0,
  gaplessOn: true,
  playbackRate: 1,
};

/**
 * Reads a stored object back, ignoring anything unexpected in it.
 *
 * Settings saved before the equaliser was removed still carry its keys; they
 * are simply not read, so there is nothing to migrate.
 */
function sanitise(raw: Partial<AudioSettings> | null): AudioSettings {
  if (!raw) return DEFAULT_AUDIO_SETTINGS;

  const number = (value: unknown, fallback: number, min: number, max: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
  };

  return {
    crossfadeSeconds: number(raw.crossfadeSeconds, 0, 0, 12),
    gaplessOn: raw.gaplessOn !== false,
    playbackRate: number(raw.playbackRate, 1, 0.5, 2),
  };
}

export function readAudioSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return sanitise(raw ? (JSON.parse(raw) as Partial<AudioSettings>) : null);
  } catch {
    // Private mode, cleared storage, or a corrupt value — defaults are fine.
    return DEFAULT_AUDIO_SETTINGS;
  }
}

export function writeAudioSettings(settings: AudioSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Non-fatal: the settings simply won't survive a reload.
  }
}
