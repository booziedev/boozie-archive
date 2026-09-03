import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from 'fastify';

import { MIME_TYPES, config } from '../config.js';
import { library } from '../lib/library.js';
import { normalizeSize, resolveCover } from '../lib/covers.js';
import { contentDisposition, safeJoin } from '../lib/paths.js';

interface ByteRange {
  start: number;
  end: number;
}

/**
 * Parses a single-range `Range: bytes=...` header.
 * Returns `null` when the header is absent/unparseable (serve the whole file)
 * and `'unsatisfiable'` when it points outside the file (respond 416).
 */
export function parseRange(header: string | undefined, size: number): ByteRange | null | 'unsatisfiable' {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  const hasStart = rawStart !== '';
  const hasEnd = rawEnd !== '';
  if (!hasStart && !hasEnd) return null;

  let start: number;
  let end: number;

  if (!hasStart) {
    // Suffix range: "bytes=-500" means the last 500 bytes.
    const suffix = Number.parseInt(rawEnd!, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number.parseInt(rawStart!, 10);
    end = hasEnd ? Number.parseInt(rawEnd!, 10) : size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    if (end > size - 1) end = size - 1;
  }

  if (start > end || start >= size || start < 0) return 'unsatisfiable';
  return { start, end };
}

function mimeFor(ext: string): string {
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

/** Filename offered to the browser when downloading a track. */
function downloadName(track: { title: string; artist: string; trackNo: number | null; ext: string }): string {
  const prefix = track.trackNo ? `${String(track.trackNo).padStart(2, '0')} - ` : '';
  const base = `${prefix}${track.artist} - ${track.title}`
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return `${base}.${track.ext}`;
}

/**
 * Streams a file with full HTTP range support.
 *
 * This is what makes seeking work: Safari (especially the iOS PWA) issues a
 * `bytes=0-1` probe, then jumps around with further range requests, and refuses
 * to seek at all unless the server answers 206 with a correct Content-Range.
 */
async function sendFile(
  reply: FastifyReply,
  abs: string,
  options: { contentType: string; disposition: string; rangeHeader?: string; cacheControl: string },
) {
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(abs);
  } catch {
    return reply.code(404).send({ error: 'File not found on disk' });
  }
  if (!stat.isFile()) return reply.code(404).send({ error: 'Not a file' });

  const size = stat.size;
  const etag = `"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`;

  reply
    .header('Accept-Ranges', 'bytes')
    .header('Content-Type', options.contentType)
    .header('Content-Disposition', options.disposition)
    .header('Cache-Control', options.cacheControl)
    .header('Last-Modified', stat.mtime.toUTCString())
    .header('ETag', etag);

  const range = parseRange(options.rangeHeader, size);

  if (range === 'unsatisfiable') {
    return reply.code(416).header('Content-Range', `bytes */${size}`).send();
  }

  if (range) {
    const length = range.end - range.start + 1;
    return reply
      .code(206)
      .header('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
      .header('Content-Length', length)
      .send(fs.createReadStream(abs, { start: range.start, end: range.end }));
  }

  return reply.code(200).header('Content-Length', size).send(fs.createReadStream(abs));
}

/** Audio streaming, downloads and cover art. */
export const mediaRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /** Inline playback — the URL the <audio> element points at. */
  app.get('/stream/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const track = library.getTrack(id);
    if (!track) return reply.code(404).send({ error: 'Track not found' });

    const abs = safeJoin(config.musicRoot, track.path);
    if (!abs) return reply.code(400).send({ error: 'Invalid track path' });

    return sendFile(reply, abs, {
      contentType: mimeFor(track.ext),
      disposition: contentDisposition(path.basename(track.path), 'inline'),
      rangeHeader: request.headers.range,
      cacheControl: 'public, max-age=86400',
    });
  });

  /** Same bytes, but forced as a download with a human-readable filename. */
  app.get('/download/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const track = library.getTrack(id);
    if (!track) return reply.code(404).send({ error: 'Track not found' });

    const abs = safeJoin(config.musicRoot, track.path);
    if (!abs) return reply.code(400).send({ error: 'Invalid track path' });

    return sendFile(reply, abs, {
      contentType: 'application/octet-stream',
      disposition: contentDisposition(downloadName(track), 'attachment'),
      rangeHeader: request.headers.range,
      cacheControl: 'public, max-age=3600',
    });
  });

  /**
   * Cover art for an album, artist or track id.
   * `?size=` is snapped to a configured thumbnail size so the cache stays small.
   */
  app.get('/cover/:id', async (request, reply) => {
    const { id: rawId } = request.params as { id: string };
    const { size: rawSize } = request.query as { size?: string };

    // Tracks inherit their album's artwork.
    let id = rawId;
    if (!library.coverSource(id)) {
      const track = library.getTrack(id);
      if (track?.coverId) id = track.coverId;
    }

    const size = normalizeSize(rawSize ? Number.parseInt(rawSize, 10) : undefined);
    const cover = await resolveCover(id, size);
    if (!cover) return reply.code(404).send({ error: 'No cover art available' });

    return sendFile(reply, cover.file, {
      contentType: cover.contentType,
      disposition: contentDisposition(`${id}.jpg`, 'inline'),
      rangeHeader: undefined,
      cacheControl: 'public, max-age=604800',
    });
  });
};
