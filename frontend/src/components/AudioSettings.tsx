import { AudioLines, RotateCcw, SlidersVertical } from 'lucide-react';

import { EQ_BANDS, EQ_MAX_DB } from '../lib/audioGraph';
import { EQ_PRESETS, FLAT, type ReplayGainMode } from '../lib/audioSettings';
import { usePlayer } from '../context/PlayerContext';

/** "1 kHz" reads better than "1000 Hz" on a cramped slider label. */
function bandLabel(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}k` : String(hz);
}

const LEVELLING: { value: ReplayGainMode; label: string; description: string }[] = [
  { value: 'off', label: 'Off', description: 'Play every file at its own level.' },
  {
    value: 'track',
    label: 'Per track',
    description: 'Even out loudness between individual songs on shuffle.',
  },
  {
    value: 'album',
    label: 'Per album',
    description: 'Level between releases but keep the quiet and loud moments within one.',
  },
];

/**
 * Equaliser, loudness levelling and playback speed.
 *
 * All of it is stored on the device rather than the account: an EQ curve
 * belongs to the headphones you are wearing, and following you onto a different
 * pair would be wrong rather than convenient.
 */
export function AudioSettingsSection() {
  const { audio, setAudio, audioGraphReady } = usePlayer();

  const activePreset = EQ_PRESETS.find(
    (preset) => preset.gains.every((gain, index) => gain === audio.gains[index]),
  );

  function setBand(index: number, value: number) {
    const gains = [...audio.gains];
    gains[index] = value;
    setAudio({ gains, eqOn: true });
  }

  return (
    <section className="surface space-y-6 p-5">
      <div className="flex items-center gap-2">
        <AudioLines size={17} className="text-accent-400" />
        <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-300">Sound</h2>
      </div>

      {/*
        The graph is either in the audio path or it is not, and the controls are
        useless without it. Saying so beats leaving sliders that quietly do
        nothing.
      */}
      {!audioGraphReady && audio.enabled && (
        <p className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs leading-relaxed text-amber-200">
          This browser wouldn't let the archive process audio, so the equaliser and
          levelling are unavailable here. Playback is unaffected.
        </p>
      )}

      {/* ------------------------------ equaliser ------------------------- */}
      <div>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={audio.eqOn}
            disabled={!audioGraphReady}
            onChange={(event) => setAudio({ eqOn: event.target.checked })}
            className="mt-0.5 h-4 w-4 shrink-0 accent-accent-500"
          />
          <span>
            <span className="block text-sm font-medium text-zinc-200">Equaliser</span>
            <span className="block text-xs leading-relaxed text-zinc-500">
              Ten bands, ±{EQ_MAX_DB} dB each. Use the preamp to pull the level back down if a
              boosted curve starts to distort.
            </span>
          </span>
        </label>

        <div
          className={`mt-4 transition-opacity ${audio.eqOn && audioGraphReady ? '' : 'pointer-events-none opacity-40'}`}
        >
          {/* Sliders run vertically, the way an EQ is always drawn. */}
          <div className="flex items-end justify-between gap-1 overflow-x-auto pb-1">
            {EQ_BANDS.map((hz, index) => (
              <div key={hz} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                <span className="text-[10px] tabular-nums text-zinc-500">
                  {audio.gains[index]! > 0 ? '+' : ''}
                  {audio.gains[index]}
                </span>
                <input
                  type="range"
                  min={-EQ_MAX_DB}
                  max={EQ_MAX_DB}
                  step={1}
                  value={audio.gains[index]}
                  onChange={(event) => setBand(index, Number(event.target.value))}
                  aria-label={`${bandLabel(hz)} Hz`}
                  className="eq-slider"
                />
                <span className="text-[10px] text-zinc-600">{bandLabel(hz)}</span>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            {EQ_PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                onClick={() => setAudio({ gains: preset.gains, eqOn: true })}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  activePreset?.name === preset.name
                    ? 'bg-accent-500 text-white'
                    : 'border border-white/10 text-zinc-400 hover:border-white/20 hover:text-zinc-200'
                }`}
              >
                {preset.name}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setAudio({ gains: FLAT, preampDb: 0 })}
              className="ml-auto inline-flex items-center gap-1 rounded-full border border-white/10 px-2.5 py-1 text-xs text-zinc-500 transition-colors hover:border-white/20 hover:text-zinc-300"
            >
              <RotateCcw size={11} />
              Reset
            </button>
          </div>

          <label className="mt-4 block">
            <span className="mb-1.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">
              Preamp
              <span className="tabular-nums">
                {audio.preampDb > 0 ? '+' : ''}
                {audio.preampDb} dB
              </span>
            </span>
            <input
              type="range"
              min={-12}
              max={12}
              step={1}
              value={audio.preampDb}
              onChange={(event) => setAudio({ preampDb: Number(event.target.value) })}
              aria-label="Preamp"
              className="vault-range"
              style={{ ['--range-progress' as string]: `${((audio.preampDb + 12) / 24) * 100}%` }}
            />
          </label>
        </div>
      </div>

      {/* ------------------------- loudness levelling --------------------- */}
      <div className="border-t border-white/5 pt-5">
        <p className="mb-1 text-sm font-medium text-zinc-200">Loudness levelling</p>
        <p className="mb-3 text-xs leading-relaxed text-zinc-500">
          Uses the ReplayGain values in your files, so it only affects tracks that carry them.
          Nothing is re-encoded — the gain is applied on the way out.
        </p>

        <div className="space-y-2">
          {LEVELLING.map((option) => (
            <label
              key={option.value}
              className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors ${
                audio.replayGain === option.value
                  ? 'border-accent-500/60 bg-white/[0.06]'
                  : 'border-white/10 hover:border-white/20'
              } ${audioGraphReady ? '' : 'pointer-events-none opacity-40'}`}
            >
              <input
                type="radio"
                name="replay-gain"
                value={option.value}
                checked={audio.replayGain === option.value}
                disabled={!audioGraphReady}
                onChange={() => setAudio({ replayGain: option.value })}
                className="mt-0.5 h-4 w-4 shrink-0 accent-accent-500"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-zinc-200">{option.label}</span>
                <span className="block text-xs leading-relaxed text-zinc-500">
                  {option.description}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* ---------------------------- playback speed ---------------------- */}
      <label className="block border-t border-white/5 pt-5">
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

      {/* --------------------------- the master switch -------------------- */}
      <label className="flex cursor-pointer items-start gap-3 border-t border-white/5 pt-5">
        <input
          type="checkbox"
          checked={audio.enabled}
          onChange={(event) => setAudio({ enabled: event.target.checked })}
          className="mt-0.5 h-4 w-4 shrink-0 accent-accent-500"
        />
        <span>
          <span className="block text-sm text-zinc-200">Let the archive process audio</span>
          <span className="block text-xs leading-relaxed text-zinc-500">
            Required for the equaliser and levelling. Turn it off if playback misbehaves — on an
            iPhone in particular, processed audio can interfere with the lock-screen controls.
            Takes effect after a reload.
          </span>
        </span>
      </label>
    </section>
  );
}
