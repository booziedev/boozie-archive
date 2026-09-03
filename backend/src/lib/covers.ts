import fs from 'node:fs/promises';
import path from 'node:path';
import { parseFile } from 'music-metadata';

import { config } from '../config.js';
import { library } from './library.js';
import { safeJoin } from './paths.js';

/**
 * Cover art pipeline.
 *
 * Artwork lives either inside the audio file's tags or as an image next to it.
 * Both are expensive to read on every request (a FLAC picture frame can be
 * several MB), so resolved covers are written to a disk cache keyed by entity
 * id + requested size and re-used until the source file changes.
 *
 * `sharp` is an optional dependency: when it is installed we downscale to the
 * requested size, when it is not we serve the original bytes unchanged. That
 * keeps `npm install` working on a Pi that can't build native modules.
 */

type SharpModule = typeof import('sharp');
let sharpPromise: Promise<SharpModule | null> | null = null;

async function loadSharp(): Promise<SharpModule | null> {
  if (!sharpPromise) {
    sharpPromise = import('sharp')
      .then((mod) => (mod.default ?? mod) as SharpModule)
      .catch(() => null);
  }
  return sharpPromise;
}

export interface ResolvedCover {
  /** Absolute path to a file that can be streamed straight to the client. */
  file: string;
  contentType: string;
}

/** Snaps an arbitrary ?size= to one of the configured thumbnail sizes. */
export function normalizeSize(requested: number | undefined): number {
  const sizes = config.coverSizes.length > 0 ? config.coverSizes : [320];
  if (!requested || !Number.isFinite(requested)) return sizes[sizes.length - 1]!;
  for (const size of sizes) if (requested <= size) return size;
  return sizes[sizes.length - 1]!;
}

/** Content type from magic bytes — used when serving un-transcoded originals. */
export function sniffImageType(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === 'GIF8') return 'image/gif';
  if (buffer.length >= 2 && buffer.subarray(0, 2).toString('ascii') === 'BM') return 'image/bmp';
  return 'application/octet-stream';
}

/** Reads the raw artwork bytes for an entity, straight from disk or tags. */
async function readCoverBytes(id: string): Promise<{ bytes: Buffer; sourcePath: string } | null> {
  const source = library.coverSource(id);
  if (!source) return null;

  if (source.kind === 'file') {
    const abs = safeJoin(config.musicRoot, source.path);
    if (!abs) return null;
    try {
      return { bytes: await fs.readFile(abs), sourcePath: abs };
    } catch {
      return null;
    }
  }

  const track = library.getTrack(source.trackId);
  if (!track) return null;
  const abs = safeJoin(config.musicRoot, track.path);
  if (!abs) return null;
  try {
    const meta = await parseFile(abs, { duration: false, skipCovers: false });
    const picture = meta.common.picture?.[0];
    if (!picture) return null;
    return { bytes: Buffer.from(picture.data), sourcePath: abs };
  } catch {
    return null;
  }
}

async function mtimeOf(file: string): Promise<number | null> {
  try {
    const stat = await fs.stat(file);
    return stat.mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Returns a cached cover file for `id`, generating it on first request.
 * Returns null when the entity has no artwork at all.
 */
export async function resolveCover(id: string, size: number): Promise<ResolvedCover | null> {
  const source = library.coverSource(id);
  if (!source) return null;

  const sharp = await loadSharp();
  const cacheFile = path.join(
    config.coverCacheDir,
    sharp ? `${id}_${size}.jpg` : `${id}_original.bin`,
  );

  const sourcePath =
    source.kind === 'file'
      ? safeJoin(config.musicRoot, source.path)
      : safeJoin(config.musicRoot, library.getTrack(source.trackId)?.path ?? '');
  if (!sourcePath) return null;

  const [cacheMtime, sourceMtime] = await Promise.all([mtimeOf(cacheFile), mtimeOf(sourcePath)]);
  if (cacheMtime !== null && sourceMtime !== null && cacheMtime >= sourceMtime) {
    if (sharp) return { file: cacheFile, contentType: 'image/jpeg' };
    const head = await fs.open(cacheFile, 'r');
    try {
      const buffer = Buffer.alloc(16);
      await head.read(buffer, 0, 16, 0);
      return { file: cacheFile, contentType: sniffImageType(buffer) };
    } finally {
      await head.close();
    }
  }

  const raw = await readCoverBytes(id);
  if (!raw) return null;

  await fs.mkdir(config.coverCacheDir, { recursive: true });
  // Write to a temp file first so a concurrent request never reads a partial image.
  const tmp = `${cacheFile}.${process.pid}.tmp`;

  if (sharp) {
    try {
      await sharp(raw.bytes)
        .resize(size, size, { fit: 'cover', position: 'centre', withoutEnlargement: true })
        .jpeg({ quality: 82, progressive: true, mozjpeg: true })
        .toFile(tmp);
      await fs.rename(tmp, cacheFile);
      return { file: cacheFile, contentType: 'image/jpeg' };
    } catch {
      await fs.rm(tmp, { force: true });
      // Fall through to storing the original bytes.
    }
  }

  const passthrough = path.join(config.coverCacheDir, `${id}_original.bin`);
  const passthroughTmp = `${passthrough}.${process.pid}.tmp`;
  await fs.writeFile(passthroughTmp, raw.bytes);
  await fs.rename(passthroughTmp, passthrough);
  return { file: passthrough, contentType: sniffImageType(raw.bytes) };
}

/** Removes every cached cover — used after a rescan changed artwork sources. */
export async function clearCoverCache(): Promise<void> {
  await fs.rm(config.coverCacheDir, { recursive: true, force: true });
  await fs.mkdir(config.coverCacheDir, { recursive: true });
}
