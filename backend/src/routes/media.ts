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

/**
 * Parses an .lrc file into timed lines.
 *
 * The format puts one or more `[mm:ss.xx]` stamps in front of each line, and
 * a header block of `[ti:]`/`[ar:]` tags that carry no timing. Anything that
 * doesn't parse is still returned as plain text, so a malformed file degrades
 * to readable lyrics rather than to nothing.
 */
export function parseLrc(text: string): { lines: { at: number; text: string }[]; plain: string } {
  const lines: { at: number; text: string }[] = [];
  const plain: string[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const body = raw.replace(/\[[^\]]*\]/g, '').trim();
    if (!body) continue;
    plain.push(body);
    for (const stamp of stamps) {
      const minutes = Number.parseInt(stamp[1]!, 10);
      const seconds = Number.parseInt(stamp[2]!, 10);
      // A two-digit fraction is centiseconds, three is milliseconds.
      const fraction = stamp[3] ? Number.parseInt(stamp[3].padEnd(3, '0'), 10) / 1000 : 0;
      lines.push({ at: minutes * 60 + seconds + fraction, text: body });
    }
  }

  lines.sort((a, b) => a.at - b.at);
  return { lines, plain: plain.join('\n') };
}

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

  /**
   * Lyrics for a track: an .lrc sitting beside the audio if there is one,
   * otherwise whatever the tags carry.
   *
   * The sidecar wins because it is the one a person put there deliberately,
   * and it is the only source that can be time-synced.
   */
  app.get('/lyrics/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const track = library.getTrack(id);
    if (!track) return reply.code(404).send({ error: 'Track not found' });

    if (track.lyricsFile) {
      const abs = safeJoin(config.musicRoot, track.lyricsFile);
      if (abs) {
        try {
          const text = await fsp.readFile(abs, 'utf8');
          const { lines, plain } = parseLrc(text);
          return { source: 'lrc', synced: lines, text: plain || text.slice(0, 20_000) };
        } catch {
          // Deleted since the scan — fall through to the embedded tags.
        }
      }
    }

    if (track.lyrics) return { source: 'tags', synced: [], text: track.lyrics };
    return reply.code(404).send({ error: 'No lyrics for this track' });
  });

  /**
   * A digital booklet from the album folder, addressed by its position in the
   * album's list rather than by path — a client never names a file on disk.
   */
  app.get('/booklet/:albumId/:index', async (request, reply) => {
    const { albumId, index } = request.params as { albumId: string; index: string };
    const album = library.getAlbum(albumId);
    const booklets = album?.booklets ?? [];
    const position = Number.parseInt(index, 10);
    const relative = Number.isFinite(position) ? booklets[position] : undefined;
    if (!relative) return reply.code(404).send({ error: 'No such booklet' });

    const abs = safeJoin(config.musicRoot, relative);
    if (!abs) return reply.code(400).send({ error: 'Invalid booklet path' });

    return sendFile(reply, abs, {
      contentType: 'application/pdf',
      disposition: contentDisposition(path.basename(relative), 'inline'),
      rangeHeader: request.headers.range,
      cacheControl: 'public, max-age=86400',
    });
  });
};
