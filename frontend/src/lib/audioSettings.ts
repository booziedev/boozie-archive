import { EQ_BANDS } from './audioGraph';

/**
 * Playback settings that belong to the device, not the account.
 *
 * An EQ curve is a property of the headphones you are wearing, and a levelling
 * preference is a property of the room you are in. Syncing them to the server
 * would mean the curve you set for your car stereo following you onto your
 * desk speakers, so they live in localStorage and stay where they were made.
 */

const KEY = 'boozie.audio.v1';

export type ReplayGainMode = 'off' | 'track' | 'album';

export interface AudioSettings {
  /** Master switch for the whole graph. Applied on reload — see below. */
  enabled: boolean;
  eqOn: boolean;
  /** One gain in dB per band in EQ_BANDS. */
  gains: number[];
  preampDb: number;
  replayGain: ReplayGainMode;
  replayGainPreampDb: number;
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

export const FLAT: number[] = EQ_BANDS.map(() => 0);

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  enabled: true,
  eqOn: false,
  gains: FLAT,
  preampDb: 0,
  replayGain: 'off',
  replayGainPreampDb: 0,
  crossfadeSeconds: 0,
  gaplessOn: true,
  playbackRate: 1,
};

/** Ready-made curves, in the same band order. */
export const EQ_PRESETS: { name: string; gains: number[] }[] = [
  { name: 'Flat', gains: FLAT },
  { name: 'Bass boost', gains: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  { name: 'Bass cut', gains: [-6, -5, -3, -1, 0, 0, 0, 0, 0, 0] },
  { name: 'Vocal', gains: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1] },
  { name: 'Treble', gains: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6] },
  { name: 'Loudness', gains: [5, 4, 2, 0, -1, -1, 0, 2, 4, 5] },
  { name: 'Podcast', gains: [-4, -3, -1, 2, 4, 4, 2, 0, -1, -2] },
];

function sanitise(raw: Partial<AudioSettings> | null): AudioSettings {
  if (!raw) return DEFAULT_AUDIO_SETTINGS;

  const gains = Array.isArray(raw.gains)
    ? EQ_BANDS.map((_, index) => {
        const value = Number(raw.gains![index]);
        return Number.isFinite(value) ? Math.min(Math.max(value, -12), 12) : 0;
      })
    : FLAT;

  const number = (value: unknown, fallback: number, min: number, max: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
  };

  return {
    enabled: raw.enabled !== false,
    eqOn: raw.eqOn === true,
    gains,
    preampDb: number(raw.preampDb, 0, -12, 12),
    replayGain:
      raw.replayGain === 'track' || raw.replayGain === 'album' ? raw.replayGain : 'off',
    replayGainPreampDb: number(raw.replayGainPreampDb, 0, -12, 12),
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
