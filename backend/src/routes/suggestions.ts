import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { config } from '../config.js';
import { AuthError } from '../lib/auth.js';
import {
  ALLOWED_SUGGESTION_EXTENSIONS,
  assertUploadAllowed,
  createFeatureSuggestion,
  createTrackSuggestion,
  formatForExtension,
  listMySuggestions,
  sanitizeFileName,
  sniffAudio,
} from '../lib/suggestions.js';

/**
 * Member-facing suggestion endpoints.
 *
 * An upload is written straight to the quarantine directory as a stream — never
 * buffered whole in memory, because a lossless track can be a hundred megabytes
 * and this runs on a Pi. Once on disk its first bytes are checked against the
 * signatures for the four accepted formats; anything else is deleted
 * immediately and never reaches the review queue.
 */
export const suggestionRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/suggestions/mine', async (request) => ({
    suggestions: await listMySuggestions(request.user!.id),
    accepts: ALLOWED_SUGGESTION_EXTENSIONS,
    maxBytes: config.suggestionMaxBytes,
  }));

  /** A feature idea. */
  app.post('/suggestions', async (request, reply) => {
    const body = (request.body ?? {}) as { body?: string };
    const suggestion = await createFeatureSuggestion(request.user!.id, String(body.body ?? ''));
    return reply.code(201).send({ suggestion });
  });

  /** An audio file proposed for the collection. */
  app.post('/suggestions/upload', async (request, reply) => {
    await assertUploadAllowed(request.user!.id);

    const file = await request.file({
      limits: { fileSize: config.suggestionMaxBytes, files: 1 },
    });
    if (!file) return reply.code(400).send({ error: 'No file was uploaded.' });

    const originalName = sanitizeFileName(file.filename ?? 'upload');
    const ext = path.extname(originalName).slice(1).toLowerCase();
    const format = formatForExtension(ext);

    // Reject on the extension before writing anything at all.
    if (!format) {
      await drain(file.file);
      return reply.code(415).send({
        error: `Only ${ALLOWED_SUGGESTION_EXTENSIONS.map((e) => `.${e}`).join(', ')} files can be uploaded.`,
        code: 'unsupported_format',
      });
    }

    await fsp.mkdir(config.suggestionDir, { recursive: true });
    const storedFile = `${crypto.randomBytes(16).toString('hex')}.${format.ext}`;
    const target = path.join(config.suggestionDir, storedFile);

    try {
      await pipeline(file.file, fs.createWriteStream(target));
    } catch (error) {
      await fsp.rm(target, { force: true });
      throw error;
    }

    // @fastify/multipart sets this when the stream hit the size limit.
    if (file.file.truncated) {
      await fsp.rm(target, { force: true });
      return reply.code(413).send({
        error: `Files must be under ${Math.round(config.suggestionMaxBytes / 1024 / 1024)} MB.`,
        code: 'file_too_large',
      });
    }

    // What the file *is*, not what it was called.
    const head = await readHead(target, 16);
    const actual = sniffAudio(head);
    if (!actual || actual.ext !== format.ext) {
      await fsp.rm(target, { force: true });
      return reply.code(415).send({
        error: actual
          ? `That file is really a .${actual.ext}, not a .${format.ext}. Rename it and try again.`
          : 'That file is not a valid audio file.',
        code: 'unsupported_format',
      });
    }

    const stat = await fsp.stat(target);
    if (stat.size === 0) {
      await fsp.rm(target, { force: true });
      return reply.code(400).send({ error: 'That file is empty.' });
    }

    const note = typeof file.fields?.note === 'object' && file.fields.note && 'value' in file.fields.note
      ? String((file.fields.note as { value: unknown }).value ?? '')
      : '';

    const suggestion = await createTrackSuggestion({
      userId: request.user!.id,
      fileName: originalName,
      storedFile,
      mime: actual.mime,
      bytes: stat.size,
      note,
    }).catch(async (error: unknown) => {
      // Don't leave an orphan in quarantine if the insert fails.
      await fsp.rm(target, { force: true });
      throw error instanceof Error ? error : new AuthError('Could not save that upload.', 500);
    });

    return reply.code(201).send({ suggestion });
  });
};

/** Consumes a rejected upload so the client isn't left mid-send. */
async function drain(stream: NodeJS.ReadableStream): Promise<void> {
  await new Promise<void>((resolve) => {
    stream.on('end', () => resolve());
    stream.on('error', () => resolve());
    stream.resume();
  });
}

async function readHead(file: string, bytes: number): Promise<Buffer> {
  const handle = await fsp.open(file, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
