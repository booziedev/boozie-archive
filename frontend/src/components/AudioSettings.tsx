import { AudioLines, SlidersVertical, Waves } from 'lucide-react';

import { canControlVolume } from '../lib/crossfade';
import { usePlayer } from '../context/PlayerContext';

/**
 * Playback speed, crossfade and gapless.
 *
 * All of it is stored on the device rather than the account: how fast a record
 * plays belongs to the room you are in, and following you onto a different
 * phone would be wrong rather than convenient.
 *
 * There used to be an equaliser and loudness levelling here. They needed a Web
 * Audio graph, and that graph silenced playback outright on iOS — see
 * `lib/crossfade.ts`. Everything left works on the audio element itself.
 */
export function AudioSettingsSection() {
  const { audio, setAudio } = usePlayer();

  return (
    <section className="surface space-y-6 p-5">
      <div className="flex items-center gap-2">
        <AudioLines size={17} className="text-accent-400" />
        <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-300">Sound</h2>
      </div>

      {/* ---------------------------- playback speed ---------------------- */}
      <label className="block">
        <span className="mb-1.5 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-sm font-medium text-zinc-200">
            <SlidersVertical size={13} className="text-zinc-500" />
            Playback speed
          </span>
          <span className="text-xs tabular-nums text-zinc-400">{audio.playbackRate.toFixed(2)}×</span>
        </span>
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.05}
          value={audio.playbackRate}
          onChange={(event) => setAudio({ playbackRate: Number(event.target.value) })}
          aria-label="Playback speed"
          className="vault-range"
          style={{ ['--range-progress' as string]: `${((audio.playbackRate - 0.5) / 1.5) * 100}%` }}
        />
        {audio.playbackRate !== 1 && (
          <button
            type="button"
            onClick={() => setAudio({ playbackRate: 1 })}
            className="mt-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
          >
            Back to normal speed
          </button>
        )}
      </label>

      {/* ------------------------- crossfade and gapless ------------------ */}
      <div className="border-t border-white/5 pt-5">
        <label className="block">
          <span className="mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-sm font-medium text-zinc-200">
              <Waves size={13} className="text-zinc-500" />
              Crossfade
            </span>
            <span className="text-xs tabular-nums text-zinc-400">
              {audio.crossfadeSeconds === 0 ? 'Off' : `${audio.crossfadeSeconds}s`}
            </span>
          </span>
          <input
            type="range"
            min={0}
            max={12}
            step={1}
            value={audio.crossfadeSeconds}
            onChange={(event) => setAudio({ crossfadeSeconds: Number(event.target.value) })}
            aria-label="Crossfade"
            className="vault-range"
            style={{ ['--range-progress' as string]: `${(audio.crossfadeSeconds / 12) * 100}%` }}
          />
          <span className="mt-1.5 block text-xs leading-relaxed text-zinc-500">
            How long one track overlaps the next. Skipping by hand still cuts straight over.
            {/*
              Said here rather than left to be discovered. iOS hands the volume
              to the hardware switch and ignores anything a page sets, so there
              is no way to fade either track — the handover cuts instead.
            */}
            {!canControlVolume() && ' This device won’t let a page change the volume, so tracks cut over rather than overlap.'}
          </span>
        </label>

        <label className="mt-4 flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={audio.gaplessOn}
            onChange={(event) => setAudio({ gaplessOn: event.target.checked })}
            className="mt-0.5 h-4 w-4 shrink-0 accent-accent-500"
          />
          <span>
            <span className="block text-sm text-zinc-200">Gapless playback</span>
            <span className="block text-xs leading-relaxed text-zinc-500">
              Loads the next track while this one plays, so a mix or a live record runs straight
              through. Uses a little more data.
            </span>
          </span>
        </label>
      </div>
    </section>
  );
}
