import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { AuthError } from './auth.js';

/**
 * Member suggestions: a feature idea, or an audio file proposed for the
 * collection.
 *
 * Uploaded audio is quarantined in DATA_DIR/suggestions — never inside
 * MUSIC_ROOT — so a file nobody has reviewed is not indexed by the scanner, not
 * streamable and not downloadable. Only an admin accepting it moves it into the
 * library, and only then under a name this server generates.
 */

export type SuggestionKind = 'feature' | 'track';
export type SuggestionStatus = 'pending' | 'accepted' | 'denied';

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  body: string | null;
  fileName: string | null;
  mime: string | null;
  bytes: number | null;
  status: SuggestionStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  libraryPath: string | null;
  createdAt: string;
  /** Who suggested it; null once that account is deleted. */
  author: string | null;
  authorId: string | null;
}

/**
 * Accepted audio formats.
 *
 * The extension alone proves nothing, so each entry also carries a signature
 * check against the file's first bytes. A .mp3 that is really a shell script
 * fails here, before an admin ever sees it in the queue.
 */
const AUDIO_FORMATS: {
  ext: string;
  mime: string;
  test: (head: Buffer) => boolean;
}[] = [
  {
    ext: 'mp3',
    mime: 'audio/mpeg',
    // Either an ID3 tag, or a raw MPEG frame sync.
    test: (b) =>
      b.subarray(0, 3).toString('ascii') === 'ID3' ||
      (b.length > 1 && b[0] === 0xff && (b[1]! & 0xe0) === 0xe0),
  },
  {
    ext: 'flac',
    mime: 'audio/flac',
    test: (b) => b.subarray(0, 4).toString('ascii') === 'fLaC',
  },
  {
    ext: 'wav',
    mime: 'audio/wav',
    test: (b) =>
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WAVE',
  },
  {
    ext: 'm4a',
    mime: 'audio/mp4',
    // ISO base media: 'ftyp' at offset 4, with an audio-capable brand.
    test: (b) => {
      if (b.subarray(4, 8).toString('ascii') !== 'ftyp') return false;
      const brand = b.subarray(8, 12).toString('ascii');
      return ['M4A ', 'M4B ', 'mp42', 'mp41', 'isom', 'iso2', 'dash'].includes(brand);
    },
  },
];

export const ALLOWED_SUGGESTION_EXTENSIONS = AUDIO_FORMATS.map((format) => format.ext);

/** Matches an extension to its format entry. */
export function formatForExtension(ext: string) {
  return AUDIO_FORMATS.find((format) => format.ext === ext.toLowerCase()) ?? null;
}

/** Identifies a file from its first bytes, ignoring what it claims to be. */
export function sniffAudio(head: Buffer) {
  return AUDIO_FORMATS.find((format) => format.test(head)) ?? null;
}

/**
 * Strips a client-supplied filename down to something safe to store and later
 * write into the library: no directories, no control characters, no leading
 * dots, bounded length.
 */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? 'upload';
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim();
  return (cleaned || 'upload').slice(0, 150);
}

interface Row {
  id: string;
  user_id: string | null;
  kind: SuggestionKind;
  body: string | null;
  file_name: string | null;
  stored_file: string | null;
  mime: string | null;
  bytes: string | null;
  status: SuggestionStatus;
  review_note: string | null;
  reviewed_at: Date | null;
  library_path: string | null;
  created_at: Date;
  author: string | null;
  reviewer: string | null;
}

function toSuggestion(row: Row): Suggestion {
  return {
    id: row.id,
    kind: row.kind,
    body: row.body,
    fileName: row.file_name,
    mime: row.mime,
    bytes: row.bytes === null ? null : Number(row.bytes),
    status: row.status,
    reviewNote: row.review_note,
    reviewedAt: row.reviewed_at ? row.reviewed_at.toISOString() : null,
    reviewedBy: row.reviewer,
    libraryPath: row.library_path,
    createdAt: row.created_at.toISOString(),
    author: row.author,
    authorId: row.user_id,
  };
}

const SELECT = `
  SELECT s.*, u.username AS author, r.username AS reviewer
    FROM suggestions s
    LEFT JOIN users u ON u.id = s.user_id
    LEFT JOIN users r ON r.id = s.reviewed_by`;

// ------------------------------------------------------------------ creating

export async function createFeatureSuggestion(userId: string, body: string): Promise<Suggestion> {
  const text = body.trim();
  if (text.length < 4) {
    throw new AuthError('Tell us a little more than that.', 400, 'suggestion_too_short');
  }
  if (text.length > 2000) {
    throw new AuthError('Suggestions can be at most 2000 characters.', 400, 'suggestion_too_long');
  }

  const { rows } = await pool.query<Row>(
    `WITH inserted AS (
       INSERT INTO suggestions (user_id, kind, body) VALUES ($1, 'feature', $2) RETURNING *
     )
     SELECT inserted.*, u.username AS author, NULL::text AS reviewer
       FROM inserted LEFT JOIN users u ON u.id = inserted.user_id`,
    [userId, text],
  );
  return toSuggestion(rows[0]!);
}

/** Records an already-quarantined upload. */
export async function createTrackSuggestion(input: {
  userId: string;
  fileName: string;
  storedFile: string;
  mime: string;
  bytes: number;
  note?: string | null;
}): Promise<Suggestion> {
  const { rows } = await pool.query<Row>(
    `WITH inserted AS (
       INSERT INTO suggestions (user_id, kind, body, file_name, stored_file, mime, bytes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *
     )
     SELECT inserted.*, u.username AS author, NULL::text AS reviewer
       FROM inserted LEFT JOIN users u ON u.id = inserted.user_id`,
    [
      input.userId,
      'track',
      input.note?.trim().slice(0, 2000) || null,
      input.fileName,
      input.storedFile,
      input.mime,
      input.bytes,
    ],
  );
  return toSuggestion(rows[0]!);
}

/** Guards against one member flooding the review queue. */
export async function assertUploadAllowed(userId: string): Promise<void> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM suggestions
      WHERE user_id = $1 AND kind = 'track' AND created_at > now() - interval '1 hour'`,
    [userId],
  );
  if (Number.parseInt(rows[0]?.count ?? '0', 10) >= config.suggestionUploadsPerHour) {
    throw new AuthError('You have uploaded a lot recently — try again later.', 429, 'rate_limited');
  }
}

// ------------------------------------------------------------------- reading

export async function listMySuggestions(userId: string): Promise<Suggestion[]> {
  const { rows } = await pool.query<Row>(
    `${SELECT} WHERE s.user_id = $1 ORDER BY s.created_at DESC LIMIT 100`,
    [userId],
  );
  return rows.map(toSuggestion);
}

export async function listSuggestions(status?: SuggestionStatus): Promise<Suggestion[]> {
  const { rows } = await pool.query<Row>(
    `${SELECT} ${status ? 'WHERE s.status = $1' : ''} ORDER BY s.created_at DESC LIMIT 300`,
    status ? [status] : [],
  );
  return rows.map(toSuggestion);
}

export async function getSuggestion(
  id: string,
): Promise<(Suggestion & { storedFile: string | null }) | null> {
  const { rows } = await pool.query<Row>(`${SELECT} WHERE s.id = $1`, [id]);
  if (!rows[0]) return null;
  return { ...toSuggestion(rows[0]), storedFile: rows[0].stored_file };
}

export async function countPending(): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM suggestions WHERE status = 'pending'`,
  );
  return Number.parseInt(rows[0]?.count ?? '0', 10);
}

/** Absolute path of a quarantined upload, or null if the name isn't ours. */
export function quarantinePath(storedFile: string): string | null {
  if (!/^[a-f0-9]{32}\.[a-z0-9]{2,5}$/.test(storedFile)) return null;
  return path.join(config.suggestionDir, storedFile);
}

// ------------------------------------------------------------------ reviewing

/**
 * Accepts a suggestion. For an upload this is the only path by which a member's
 * file reaches the library: it is moved out of quarantine into a dedicated
 * folder under MUSIC_ROOT, under a name built here from the sanitised original.
 */
export async function acceptSuggestion(
  id: string,
  adminId: string,
  note?: string | null,
): Promise<Suggestion> {
  const suggestion = await getSuggestion(id);
  if (!suggestion) throw new AuthError('Suggestion not found.', 404, 'not_found');
  if (suggestion.status !== 'pending') {
    throw new AuthError('That suggestion has already been reviewed.', 409, 'already_reviewed');
  }

  let libraryPath: string | null = null;

  if (suggestion.kind === 'track' && suggestion.storedFile) {
    const source = quarantinePath(suggestion.storedFile);
    if (!source) throw new AuthError('That upload is no longer available.', 410, 'file_missing');

    // The row can outlive the file (a cleared quarantine, a manual delete), so
    // check before moving rather than surfacing a raw ENOENT.
    try {
      await fs.access(source);
    } catch {
      throw new AuthError(
        'That upload is no longer on disk — ask for it to be sent again.',
        410,
        'file_missing',
      );
    }

    const inbox = path.join(config.musicRoot, config.suggestionInbox);
    await fs.mkdir(inbox, { recursive: true });

    // Re-derive the name here rather than trusting anything stored earlier.
    const safeName = sanitizeFileName(suggestion.fileName ?? 'upload');
    const target = await uniquePath(inbox, safeName);

    try {
      await fs.rename(source, target);
    } catch (error) {
      // DATA_DIR and MUSIC_ROOT can be on different filesystems (SD card vs
      // SSD), which rename cannot cross.
      if ((error as NodeJS.ErrnoException).code === 'EXDEV') {
        await fs.copyFile(source, target);
        await fs.rm(source, { force: true });
      } else {
        throw error;
      }
    }

    libraryPath = path.relative(config.musicRoot, target).split(path.sep).join('/');
  }

  const { rows } = await pool.query<Row>(
    `WITH updated AS (
       UPDATE suggestions
          SET status = 'accepted', reviewed_by = $2, reviewed_at = now(),
              review_note = $3, library_path = $4
        WHERE id = $1
        RETURNING *
     )
     SELECT updated.*, u.username AS author, r.username AS reviewer
       FROM updated
       LEFT JOIN users u ON u.id = updated.user_id
       LEFT JOIN users r ON r.id = updated.reviewed_by`,
    [id, adminId, note?.trim().slice(0, 500) || null, libraryPath],
  );
  return toSuggestion(rows[0]!);
}

/** Denies a suggestion and deletes the quarantined file, if there was one. */
export async function denySuggestion(
  id: string,
  adminId: string,
  note?: string | null,
): Promise<Suggestion> {
  const suggestion = await getSuggestion(id);
  if (!suggestion) throw new AuthError('Suggestion not found.', 404, 'not_found');
  if (suggestion.status !== 'pending') {
    throw new AuthError('That suggestion has already been reviewed.', 409, 'already_reviewed');
  }

  if (suggestion.storedFile) {
    const file = quarantinePath(suggestion.storedFile);
    if (file) await fs.rm(file, { force: true });
  }

  const { rows } = await pool.query<Row>(
    `WITH updated AS (
       UPDATE suggestions
          SET status = 'denied', reviewed_by = $2, reviewed_at = now(),
              review_note = $3, stored_file = NULL
        WHERE id = $1
        RETURNING *
     )
     SELECT updated.*, u.username AS author, r.username AS reviewer
       FROM updated
       LEFT JOIN users u ON u.id = updated.user_id
       LEFT JOIN users r ON r.id = updated.reviewed_by`,
    [id, adminId, note?.trim().slice(0, 500) || null],
  );
  return toSuggestion(rows[0]!);
}

/** Never overwrite an existing track: "song.mp3" becomes "song (2).mp3". */
async function uniquePath(dir: string, fileName: string): Promise<string> {
  const ext = path.extname(fileName);
  const stem = path.basename(fileName, ext);
  let candidate = path.join(dir, fileName);

  for (let counter = 2; counter < 500; counter += 1) {
    try {
      await fs.access(candidate);
    } catch {
      return candidate;
    }
    candidate = path.join(dir, `${stem} (${counter})${ext}`);
  }
  return path.join(dir, `${stem} (${crypto.randomBytes(4).toString('hex')})${ext}`);
}
