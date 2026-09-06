/**
 * The Web Audio graph behind the player.
 *
 *   <audio> -> MediaElementSource -> preamp -> [10 biquads] -> ReplayGain -> out
 *
 * Built once and always in the path, even with everything switched off, for a
 * reason that is easy to get wrong: `createMediaElementSource()` cannot be
 * undone. Once an element has been routed through a graph its audio only ever
 * comes out of that graph, and this app deliberately keeps a single element for
 * its whole lifetime because iOS will only play one that a user gesture
 * unlocked. Routing conditionally would mean either a second element (which iOS
 * would refuse to start) or silence.
 *
 * So: flat filters and unity gains are the "off" state, not a bypassed graph.
 */

/** Centre frequencies, the usual ten-band spread from sub-bass to air. */
export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

/** Per-band range in dB. Wider than this and everything clips. */
export const EQ_MAX_DB = 12;

export interface AudioGraph {
  context: AudioContext;
  /** Overall level before the filters, for taming an aggressive curve. */
  preamp: GainNode;
  bands: BiquadFilterNode[];
  /** Loudness levelling, driven by the track's ReplayGain tags. */
  replayGain: GainNode;
  /** Attached on demand, only while something is watching the levels. */
  analyser: AnalyserNode | null;
}

/**
 * Whether this browser can route the element without silencing it.
 *
 * Feeding a cross-origin element into a graph produces silence unless the
 * response carried CORS headers, and there is no way to detect that after the
 * fact — the graph simply outputs nothing. Rather than gamble with the audio,
 * the graph is only built when the media is same-origin or the element has been
 * marked cross-origin (which means the server is sending the headers).
 */
export function canRouteThroughGraph(audio: HTMLAudioElement): boolean {
  if (typeof window === 'undefined') return false;
  if (!('AudioContext' in window || 'webkitAudioContext' in window)) return false;
  // Same-origin media, or an element explicitly opted into CORS.
  return audio.crossOrigin !== null || sameOriginMedia();
}

function sameOriginMedia(): boolean {
  try {
    const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
    if (!base) return true;
    return new URL(base, window.location.href).origin === window.location.origin;
  } catch {
    return true;
  }
}

/**
 * Builds the graph around an element. Returns null when routing would risk
 * silencing playback, in which case the caller leaves the element alone.
 */
export function createAudioGraph(audio: HTMLAudioElement): AudioGraph | null {
  if (!canRouteThroughGraph(audio)) return null;

  const Ctor: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

  let context: AudioContext;
  let source: MediaElementAudioSourceNode;
  try {
    context = new Ctor();
    source = context.createMediaElementSource(audio);
  } catch {
    // Already routed, or the browser refused. Either way, leave playback alone.
    return null;
  }

  const preamp = context.createGain();
  preamp.gain.value = 1;

  const bands = EQ_BANDS.map((frequency, index) => {
    const filter = context.createBiquadFilter();
    // Shelves at the ends so the lowest and highest bands lift everything
    // beyond them, rather than a narrow bump nobody can hear the point of.
    filter.type =
      index === 0 ? 'lowshelf' : index === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
    filter.frequency.value = frequency;
    filter.Q.value = 1.1;
    filter.gain.value = 0;
    return filter;
  });

  const replayGain = context.createGain();
  replayGain.gain.value = 1;

  // source -> preamp -> band0 -> ... -> bandN -> replayGain -> destination
  source.connect(preamp);
  bands.reduce<AudioNode>((previous, filter) => {
    previous.connect(filter);
    return filter;
  }, preamp).connect(replayGain);
  replayGain.connect(context.destination);

  return { context, preamp, bands, replayGain, analyser: null };
}

/**
 * Resumes a suspended context.
 *
 * Browsers start it suspended and only allow a resume from inside a user
 * gesture, so this is called from the same click chain that starts playback.
 */
export function resumeGraph(graph: AudioGraph | null): void {
  if (graph && graph.context.state === 'suspended') void graph.context.resume().catch(() => undefined);
}

/** Applies a curve, in dB per band, plus the preamp. */
export function applyEq(graph: AudioGraph | null, gains: number[], preampDb: number): void {
  if (!graph) return;
  const now = graph.context.currentTime;
  graph.bands.forEach((filter, index) => {
    const value = clampDb(gains[index] ?? 0);
    // Ramped rather than assigned: stepping a filter's gain during playback is
    // audible as a click.
    filter.gain.setTargetAtTime(value, now, 0.02);
  });
  graph.preamp.gain.setTargetAtTime(dbToGain(clampDb(preampDb)), now, 0.02);
}

/**
 * Sets the levelling gain for the track now playing.
 *
 * `peak` is the track's own peak as a 0..1 ratio. Boosting a track that already
 * peaks near full scale would clip it, so the gain is capped at whatever still
 * leaves the loudest sample under 1.
 */
export function applyReplayGain(
  graph: AudioGraph | null,
  gainDb: number | undefined,
  peak: number | undefined,
  preampDb = 0,
): void {
  if (!graph) return;

  let gain = gainDb === undefined ? 1 : dbToGain(gainDb + preampDb);
  if (peak !== undefined && peak > 0) gain = Math.min(gain, 1 / peak);
  // A hard ceiling as well: a broken tag should not be able to blow the output.
  gain = Math.min(Math.max(gain, 0.05), 4);

  graph.replayGain.gain.setTargetAtTime(gain, graph.context.currentTime, 0.05);
}

/** Attaches an analyser, for anything that wants to watch the output. */
export function attachAnalyser(graph: AudioGraph | null): AnalyserNode | null {
  if (!graph) return null;
  if (graph.analyser) return graph.analyser;
  const analyser = graph.context.createAnalyser();
  analyser.fftSize = 2048;
  // Tapped off the end of the chain, not spliced into it, so it can never
  // affect what comes out of the speakers.
  graph.replayGain.connect(analyser);
  graph.analyser = analyser;
  return analyser;
}

function clampDb(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, -EQ_MAX_DB), EQ_MAX_DB);
}

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}
