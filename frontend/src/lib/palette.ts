import { useEffect, useState } from 'react';

import { mediaCrossOrigin } from './config';

/**
 * The two or three colours a piece of cover art is actually made of.
 *
 * Used to tint the now-playing screen so the background belongs to the record
 * rather than to the app. Sampling the real artwork is the only way to get
 * that: a hash of the album id gives a stable colour, but not the *right* one,
 * and the difference is obvious the moment you put them side by side.
 *
 * Everything here fails soft. A cover that will not load, a canvas the browser
 * refuses to read back, an image that turns out to be one flat grey — all of
 * them return null, and the caller keeps whatever it was showing before.
 */

/** The sampled square. Small on purpose: this is colour, not detail. */
const SAMPLE = 32;

/** How coarsely pixels are grouped, in bits dropped per channel. */
const QUANTIZE = 4;

export type Palette = [string, string, string];

const cache = new Map<string, Palette | null>();
const pending = new Map<string, Promise<Palette | null>>();

function toRgb(r: number, g: number, b: number): string {
  return `rgb(${r} ${g} ${b})`;
}

/** Loads an image the canvas is allowed to read back from. */
function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    // Without this the canvas is tainted and getImageData throws. With it, a
    // server that sends no CORS headers fails the load instead — which is the
    // better failure, because it is the one we can detect.
    const cors = mediaCrossOrigin();
    image.crossOrigin = cors ?? 'anonymous';
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('cover did not load'));
    image.src = url;
  });
}

interface Bucket {
  count: number;
  r: number;
  g: number;
  b: number;
}

/**
 * Groups the pixels and returns the buckets worth looking at, busiest first.
 *
 * Near-black and near-white are dropped before counting. Album art is mostly
 * background, and on a dark sleeve the winning bucket is always "black" — which
 * makes a gradient that is indistinguishable from no gradient at all.
 */
function collect(data: Uint8ClampedArray): Bucket[] {
  const buckets = new Map<number, Bucket>();

  for (let i = 0; i < data.length; i += 4) {
    if ((data[i + 3] ?? 0) < 128) continue;
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max < 32 || min > 232) continue;
    // Grey carries no hue, so it cannot contribute to a gradient — but a
    // genuinely monochrome sleeve has nothing else, so this is a preference
    // expressed by ordering, not an exclusion. Keep it, rank it last.
    const key =
      ((r >> QUANTIZE) << (16 - QUANTIZE * 2)) |
      ((g >> QUANTIZE) << (8 - QUANTIZE)) |
      (b >> QUANTIZE);

    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count += 1;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
    } else {
      buckets.set(key, { count: 1, r, g, b });
    }
  }

  return [...buckets.values()]
    .map((bucket) => ({
      count: bucket.count,
      r: Math.round(bucket.r / bucket.count),
      g: Math.round(bucket.g / bucket.count),
      b: Math.round(bucket.b / bucket.count),
    }))
    .sort((a, b) => {
      // A colourful bucket beats a larger grey one, but only just: the weight
      // is a nudge, so a sleeve that really is mostly one colour still wins.
      const saturation = (x: Bucket) => Math.max(x.r, x.g, x.b) - Math.min(x.r, x.g, x.b);
      return b.count * (1 + saturation(b) / 128) - a.count * (1 + saturation(a) / 128);
    });
}

/** How far apart two colours are, roughly, in plain channel distance. */
function distance(a: Bucket, b: Bucket): number {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

/**
 * Three colours, as different from each other as the artwork allows.
 *
 * Picking the top three buckets outright tends to give three shades of the
 * same thing, because a photograph's most common colours are neighbours. So
 * each pick has to be some distance from the ones already chosen, and the
 * threshold relaxes if the sleeve genuinely has nothing else to offer.
 */
function choose(buckets: Bucket[]): Palette | null {
  const first = buckets[0];
  if (!first) return null;

  const chosen: Bucket[] = [first];
  for (const threshold of [180, 90, 30]) {
    for (const bucket of buckets) {
      if (chosen.length === 3) break;
      if (chosen.every((picked) => distance(picked, bucket) >= threshold)) chosen.push(bucket);
    }
  }

  // A single-colour sleeve pads out with darker versions of itself, which still
  // reads as a gradient rather than as a flat wash.
  while (chosen.length < 3) {
    const last = chosen[chosen.length - 1]!;
    chosen.push({
      count: 0,
      r: Math.round(last.r * 0.55),
      g: Math.round(last.g * 0.55),
      b: Math.round(last.b * 0.55),
    });
  }

  return chosen.slice(0, 3).map((c) => toRgb(c.r, c.g, c.b)) as Palette;
}

/**
 * The palette for one image URL, or null if it could not be read.
 *
 * Cached per URL — including the failures, so a cover with no CORS headers is
 * not re-fetched every time it comes round in the queue — and deduplicated
 * while in flight, since the bar and the now-playing screen ask at once.
 */
export function extractPalette(url: string): Promise<Palette | null> {
  const cached = cache.get(url);
  if (cached !== undefined) return Promise.resolve(cached);

  const existing = pending.get(url);
  if (existing) return existing;

  const work = (async () => {
    try {
      const image = await load(url);
      const canvas = document.createElement('canvas');
      canvas.width = SAMPLE;
      canvas.height = SAMPLE;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return null;
      context.drawImage(image, 0, 0, SAMPLE, SAMPLE);
      // Throws on a tainted canvas, which is the cross-origin-without-headers
      // case the crossOrigin attribute above is meant to turn into a load
      // failure — belt and braces, because getting this wrong is a hard error.
      const { data } = context.getImageData(0, 0, SAMPLE, SAMPLE);
      return choose(collect(data));
    } catch {
      return null;
    }
  })()
    .then((result) => {
      cache.set(url, result);
      return result;
    })
    .finally(() => pending.delete(url));

  pending.set(url, work);
  return work;
}

/**
 * The palette for a cover, re-read whenever the URL changes.
 *
 * Returns null until it has one, and goes back to null on a track with
 * unreadable artwork — callers are expected to have a fallback already on
 * screen rather than to wait for this.
 */
export function usePalette(url: string | null): Palette | null {
  const [palette, setPalette] = useState<Palette | null>(() =>
    url ? cache.get(url) ?? null : null,
  );

  useEffect(() => {
    if (!url) {
      setPalette(null);
      return;
    }

    let live = true;
    void extractPalette(url).then((result) => {
      if (live) setPalette(result);
    });
    return () => {
      live = false;
    };
  }, [url]);

  return palette;
}
