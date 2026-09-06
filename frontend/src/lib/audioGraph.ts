/**
 * The Web Audio graph behind the player.
 *
 *   deck A <audio> -> source -> fade -> ReplayGain -\
 *                                                    >- preamp -> [10 biquads] -> out
 *   deck B <audio> -> source -> fade -> ReplayGain -/
 *
 * Built once and always in the path, even with everything switched off, for a
 * reason that is easy to get wrong: `createMediaElementSource()` cannot be
 * undone. Once an element has been routed through a graph its audio only ever
 * comes out of that graph, and the elements themselves live for the whole
 * lifetime of the app because iOS will only play one that a user gesture
 * unlocked. Routing conditionally would mean either a fresh element (which iOS
 * would refuse to start) or silence.
 *
 * So: flat filters and unity gains are the "off" state, not a bypassed graph.
 *
 * There are two decks because a crossfade needs both tracks audible at once,
 * and gapless needs the next one already buffered and ready to start. Only one
 * is the active deck at a time; the other sits at a fade gain of zero.
 * Levelling is per deck (the two tracks have different tags) while the EQ is
 * shared — it belongs to the headphones, not the track.
 */

/** Centre frequencies, the usual ten-band spread from sub-bass to air. */
export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

/** Per-band range in dB. Wider than this and everything clips. */
export const EQ_MAX_DB = 12;

export interface GraphDeck {
  element: HTMLAudioElement;
  /** 1 for the deck you are hearing, 0 for the one waiting; ramped between. */
  fade: GainNode;
  /** Loudness levelling for whatever this deck is playing. */
  replayGain: GainNode;
}

export interface AudioGraph {
  context: AudioContext;
  decks: GraphDeck[];
  /** Overall level before the filters, for taming an aggressive curve. */
  preamp: GainNode;
  bands: BiquadFilterNode[];
  /** Attached on demand, only while something is watching the levels. */
  analyser: AnalyserNode | null;
}

/**
 * Whether this browser can route the elements without silencing them.
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
 * Builds the graph around the decks. Returns null when routing would risk
 * silencing playback, in which case the caller leaves the elements alone.
 *
 * The first deck starts audible and the rest silent, which matches the
 * player's own idea of which one is active.
 */
export function createAudioGraph(elements: HTMLAudioElement[]): AudioGraph | null {
  if (elements.length === 0 || !elements.every(canRouteThroughGraph)) return null;

  const Ctor: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

  let context: AudioContext;
  let decks: GraphDeck[];
  try {
    context = new Ctor();
    decks = elements.map((element, index) => {
      const source = context.createMediaElementSource(element);
      const fade = context.createGain();
      fade.gain.value = index === 0 ? 1 : 0;
      const replayGain = context.createGain();
      replayGain.gain.value = 1;
      source.connect(fade);
      fade.connect(replayGain);
      return { element, fade, replayGain };
    });
  } catch {
    // Already routed, or the browser refused. Either way, leave playback alone.
    return null;
  }

  const preamp = context.createGain();
  preamp.gain.value = 1;
  for (const deck of decks) deck.replayGain.connect(preamp);

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

  // preamp -> band0 -> ... -> bandN -> destination
  bands.reduce<AudioNode>((previous, filter) => {
    previous.connect(filter);
    return filter;
  }, preamp).connect(context.destination);

  return { context, decks, preamp, bands, analyser: null };
}

/**
 * Resumes a suspended context.
 *
 * Browsers start it suspended and only allow a resume from inside a user
 * gesture, so this is called from the same click chain that reaches play().
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
 * Sets the levelling gain for the track on one deck.
 *
 * `peak` is the track's own peak as a 0..1 ratio. Boosting a track that already
 * peaks near full scale would clip it, so the gain is capped at whatever still
 * leaves the loudest sample under 1.
 */
export function applyReplayGain(
  graph: AudioGraph | null,
  deck: number,
  gainDb: number | undefined,
  peak: number | undefined,
  preampDb = 0,
): void {
  const node = graph?.decks[deck]?.replayGain;
  if (!graph || !node) return;

  let gain = gainDb === undefined ? 1 : dbToGain(gainDb + preampDb);
  if (peak !== undefined && peak > 0) gain = Math.min(gain, 1 / peak);
  // A hard ceiling as well: a broken tag should not be able to blow the output.
  gain = Math.min(Math.max(gain, 0.05), 4);

  node.gain.setTargetAtTime(gain, graph.context.currentTime, 0.05);
}

/**
 * Fades one deck towards `target` (0 or 1) over `seconds`.
 *
 * With the graph in place this rides a gain node, which is sample-accurate and
 * unaffected by the volume slider. Without one it animates the element's own
 * volume instead — audibly the same on a desktop browser, and a hard cut on
 * iOS, which ignores volume on media elements entirely. That is the honest
 * fallback: the alternative is no crossfade at all when the graph is off.
 *
 * Returns a function that stops the animation, for the element path.
 */
export function fadeDeck(
  graph: AudioGraph | null,
  deck: number,
  element: HTMLAudioElement,
  target: number,
  seconds: number,
  elementVolume = 1,
): () => void {
  const node = graph?.decks[deck]?.fade;

  if (graph && node) {
    const now = graph.context.currentTime;
    node.gain.cancelScheduledValues(now);
    // Anchored at the current value first, or the ramp starts from whatever
    // was last *scheduled* rather than what is actually playing.
    node.gain.setValueAtTime(node.gain.value, now);
    if (seconds <= 0) node.gain.setValueAtTime(target, now);
    else node.gain.linearRampToValueAtTime(target, now + seconds);
    return () => node.gain.cancelScheduledValues(graph.context.currentTime);
  }

  const from = element.volume;
  const to = target * elementVolume;
  if (seconds <= 0) {
    element.volume = clamp01(to);
    return () => undefined;
  }

  const started = performance.now();
  let frame = 0;
  const step = () => {
    const progress = Math.min(1, (performance.now() - started) / (seconds * 1000));
    element.volume = clamp01(from + (to - from) * progress);
    if (progress < 1) frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}

/** Sets a deck's fade level immediately, with no ramp. */
export function setDeckLevel(
  graph: AudioGraph | null,
  deck: number,
  element: HTMLAudioElement,
  level: number,
  elementVolume = 1,
): void {
  fadeDeck(graph, deck, element, level, 0, elementVolume);
}

/** Attaches an analyser, for anything that wants to watch the output. */
export function attachAnalyser(graph: AudioGraph | null): AnalyserNode | null {
  if (!graph) return null;
  if (graph.analyser) return graph.analyser;
  const analyser = graph.context.createAnalyser();
  analyser.fftSize = 2048;
  // Tapped off the end of the chain, not spliced into it, so it can never
  // affect what comes out of the speakers.
  graph.bands[graph.bands.length - 1]?.connect(analyser);
  graph.analyser = analyser;
  return analyser;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clampDb(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, -EQ_MAX_DB), EQ_MAX_DB);
}

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}
