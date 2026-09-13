/**
 * Deck levels, done with the audio elements themselves.
 *
 * There used to be a Web Audio graph here — two `MediaElementAudioSourceNode`s
 * into gains, an equaliser and levelling. It was removed because on iOS it
 * silenced playback outright: the decks fed a graph that never produced any
 * output, so the playhead advanced and nothing came out. Routing an element
 * through `createMediaElementSource` cannot be undone, which is what made that
 * failure permanent for anyone it happened to rather than something a retry
 * would clear.
 *
 * So levels ride `element.volume`, which is the plainest thing that works.
 */

/**
 * Whether this browser honours `element.volume` at all.
 *
 * iOS ignores it completely — volume there is the hardware switch and nothing
 * else. That matters for one thing only, and it matters a lot: a crossfade
 * ramps two volumes in opposite directions, and on a platform that ignores
 * both, an "overlap" is simply two songs playing at once at full volume. A
 * feature test rather than sniffing the user agent, because this is a
 * capability question with a direct answer.
 */
let volumeIsHonoured: boolean | null = null;

export function canControlVolume(): boolean {
  if (volumeIsHonoured !== null) return volumeIsHonoured;
  try {
    const probe = new Audio();
    probe.volume = 0.5;
    volumeIsHonoured = probe.volume !== 1;
  } catch {
    volumeIsHonoured = false;
  }
  return volumeIsHonoured;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Fades one deck towards `target` (0 or 1) over `seconds`.
 *
 * `elementVolume` is the master volume the level is scaled by, so a deck at
 * full level still plays at whatever the slider says.
 *
 * Returns a function that stops the animation part way, for when the next
 * track change arrives before this one has finished.
 */
export function fadeDeck(
  element: HTMLAudioElement,
  target: number,
  seconds: number,
  elementVolume = 1,
): () => void {
  const to = clamp01(target * elementVolume);

  // No ramp asked for, or no ramp possible: a clean cut. On iOS the second
  // case is every time, and a cut is far better than both decks at full
  // volume for the length of the overlap.
  if (seconds <= 0 || !canControlVolume()) {
    element.volume = to;
    return () => undefined;
  }

  const from = element.volume;
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

/** Sets a deck's level immediately, with no ramp. */
export function setDeckLevel(element: HTMLAudioElement, level: number, elementVolume = 1): void {
  fadeDeck(element, level, 0, elementVolume);
}
