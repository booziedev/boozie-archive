import { ZipFile } from 'yazl';

import { config } from '../config.js';
import { safeJoin } from './paths.js';
import type { Track } from '../types.js';

/**
 * Downloading a whole album or playlist as one file.
 *
 * The entries are stored, not deflated. Every format in a music library is
 * already compressed — FLAC, MP3, AAC, ALAC — so squeezing them again buys
 * approximately nothing and costs a Pi's entire CPU for the length of the
 * download. Storing means the archive streams out at disk speed.
 *
 * Zip64 is on for the reason it exists: a box set in FLAC goes past 4 GB, and
 * the classic format simply cannot describe that.
 */

export interface ArchiveEntry {
  /** Absolute path on disk. */
  path: string;
  /** The name it gets inside the archive. */
  name: string;
  size: number;
}

/**
 * Strips what filesystems object to, without mangling accents or CJK.
 *
 * Same rule the single-track download already uses, so a track downloaded on
 * its own and the same track out of an album archive arrive named identically.
 */
function safeName(value: string): string {
  return value
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/**
 * The filename a track gets inside an archive.
 *
 * `index` overrides the track number for a playlist, where the running order is
 * the playlist's rather than the album's — otherwise every track one in the
 * list would sort to the top together.
 */
export function entryName(track: Track, index?: number): string {
  const number = index === undefined ? track.trackNo : index + 1;
  const prefix = number ? `${String(number).padStart(2, '0')} - ` : '';
  return `${safeName(`${prefix}${track.artist} - ${track.title}`)}.${track.ext}`;
}

/**
 * Turns tracks into archive entries, resolving each path against MUSIC_ROOT.
 *
 * Every path goes through `safeJoin` even though they come from the index
 * rather than a request — the same rule the streaming routes follow, so a
 * corrupted index can never be used to read outside the library. Duplicate
 * names get a numeric suffix rather than quietly overwriting each other, which
 * a zip will happily let you do.
 */
export function planEntries(
  tracks: Track[],
  options: { numbered?: boolean } = {},
): { entries: ArchiveEntry[]; totalBytes: number; skipped: number } {
  const entries: ArchiveEntry[] = [];
  const used = new Set<string>();
  let totalBytes = 0;
  let skipped = 0;

  tracks.forEach((track, index) => {
    const abs = safeJoin(config.musicRoot, track.path);
    if (!abs) {
      skipped += 1;
      return;
    }

    const base = entryName(track, options.numbered ? index : undefined);
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n += 1) {
      const dot = base.lastIndexOf('.');
      name = `${base.slice(0, dot)} (${n})${base.slice(dot)}`;
    }
    used.add(name.toLowerCase());

    entries.push({ path: abs, name, size: track.size });
    totalBytes += track.size;
  });

  return { entries, totalBytes, skipped };
}

/**
 * Builds the archive stream.
 *
 * yazl opens each file as it reaches it, so memory stays flat however large the
 * album is — nothing is buffered up front, which is the whole reason to stream
 * rather than build a temporary file on the Pi's SD card.
 */
export function createArchive(entries: ArchiveEntry[]): NodeJS.ReadableStream {
  const zip = new ZipFile();
  for (const entry of entries) {
    zip.addFile(entry.path, entry.name, { compress: false });
  }
  zip.end();
  return zip.outputStream;
}

/** The name offered to the browser, ".zip" included. */
export function archiveName(label: string): string {
  return `${safeName(label) || 'download'}.zip`;
}

/**
 * One archive at a time per account.
 *
 * Building two 2 GB downloads at once on a Pi means neither finishes at a
 * sensible speed and the upstream link is saturated for everyone else. Kept in
 * memory rather than the database on purpose: it describes what this process is
 * doing right now, and a restart should forget it.
 */
const inFlight = new Set<string>();

export function beginArchive(userId: string): boolean {
  if (inFlight.has(userId)) return false;
  inFlight.add(userId);
  return true;
}

export function endArchive(userId: string): void {
  inFlight.delete(userId);
}
