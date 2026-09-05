import 'dotenv/config';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

function list(name: string, fallback: string[]): string[] {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const dataDir = path.resolve(str('DATA_DIR', path.join(process.cwd(), 'data')));

/**
 * `import.meta.url` points at backend/src/config.ts in development and
 * backend/dist/config.js in production — one level below the backend root
 * either way.
 */
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(backendRoot, '..');

const FRONTEND_DIST_CANDIDATES: string[] = (() => {
  const explicit = str('FRONTEND_DIST', '');
  if (explicit) return [path.resolve(explicit)];
  return [
    // Normal checkout: <repo>/frontend/dist next to <repo>/backend.
    path.join(repoRoot, 'frontend', 'dist'),
    // A build copied in beside the server.
    path.join(backendRoot, 'frontend', 'dist'),
    path.join(backendRoot, 'public'),
    // Fall back to the working directory for unusual layouts.
    path.join(process.cwd(), '..', 'frontend', 'dist'),
    path.join(process.cwd(), 'frontend', 'dist'),
  ].filter((value, index, all) => all.indexOf(value) === index);
})();

export const config = {
  /** Absolute path to the root of the music collection. */
  musicRoot: path.resolve(str('MUSIC_ROOT', '/home/admin/ssd/mediausb/music/')),

  host: str('HOST', '0.0.0.0'),
  port: int('PORT', 1981),

  /** Where the JSON index and the cover cache live. */
  dataDir,
  indexFile: path.join(dataDir, 'library-index.json'),
  coverCacheDir: path.join(dataDir, 'covers'),
  /** Uploaded profile pictures live here, served back via /api/avatar/:file. */
  avatarDir: path.join(dataDir, 'avatars'),
  /** Largest profile picture accepted, in bytes. Animated GIFs get sizeable. */
  avatarMaxBytes: int('AVATAR_MAX_BYTES', 5 * 1024 * 1024),
  /**
   * Suggested audio waits here — deliberately outside MUSIC_ROOT, so a file
   * nobody has reviewed is never indexed, streamed or downloadable.
   */
  suggestionDir: path.join(dataDir, 'suggestions'),
  /** Largest suggested audio file, in bytes. A long lossless track is big. */
  suggestionMaxBytes: int('SUGGESTION_MAX_BYTES', 150 * 1024 * 1024),
  /** Uploads one member may submit per hour. */
  suggestionUploadsPerHour: int('SUGGESTION_UPLOADS_PER_HOUR', 10),
  /**
   * Folder inside MUSIC_ROOT that accepted files are filed under, so they are
   * easy to find and re-tag later.
   */
  suggestionInbox: str('SUGGESTION_INBOX', 'Suggested'),

  /**
   * Allowed browser origins. "*" allows any origin, which is what you want
   * for a public, read-only archive served from a static host.
   */
  corsOrigins: list('CORS_ORIGINS', ['*']),

  /** Scan the library once at boot. Disable for very large libraries + cron. */
  scanOnStart: bool('SCAN_ON_START', true),
  /** Periodic rescan interval in minutes. 0 disables the timer. */
  scanIntervalMinutes: int('SCAN_INTERVAL_MINUTES', 360),
  /** Number of files parsed in parallel. Keep modest on a Pi's SD/SSD. */
  scanConcurrency: int('SCAN_CONCURRENCY', Math.max(2, Math.min(8, os.cpus().length))),

  /** Bearer token required by POST /api/rescan. Empty string disables the route. */
  adminToken: str('ADMIN_TOKEN', ''),

  /** Generated cover thumbnail sizes (px). Requests are snapped to these. */
  coverSizes: list('COVER_SIZES', ['128', '320', '640'])
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b),

  /** Follow symlinks while walking the collection. */
  followSymlinks: bool('FOLLOW_SYMLINKS', false),

  /**
   * Where to find the frontend's built `dist/` folder. When one of these exists
   * the server also serves the web app, so the Pi needs one process, one port
   * and one tunnel — and the browser talks to `/api` on its own origin, which
   * sidesteps CORS entirely.
   *
   * Candidates are derived from this file's own location first, so the lookup
   * works no matter which directory the process was started from (`pm2
   * resurrect`, a systemd unit with a different WorkingDirectory, or
   * `node /path/to/backend/dist/index.js` from anywhere all behave the same).
   * Set FRONTEND_DIST to pin it explicitly, or SERVE_FRONTEND=false to disable.
   */
  frontendDistCandidates: FRONTEND_DIST_CANDIDATES,
  serveFrontend: bool('SERVE_FRONTEND', true),

  logLevel: str('LOG_LEVEL', 'info'),

  // --- accounts, sessions, invites ---------------------------------------

  /**
   * When enabled (the default) every API route except the auth endpoints
   * requires a signed-in account, and registration requires an invite code.
   * Set AUTH_ENABLED=false to run the archive wide open with no database.
   */
  authEnabled: bool('AUTH_ENABLED', true),

  /**
   * Let signed-out visitors browse and play without an account. Registration
   * still needs an invite; this only relaxes reading.
   */
  allowPublicBrowse: bool('ALLOW_PUBLIC_BROWSE', false),

  databaseUrl: str('DATABASE_URL', 'postgres://boozie:boozie@localhost:5432/boozie_archive'),
  databasePoolMax: int('DATABASE_POOL_MAX', 8),
  databaseSsl: bool('DATABASE_SSL', false),

  /** How long a login lasts before the browser has to sign in again. */
  sessionTtlDays: int('SESSION_TTL_DAYS', 30),
  cookieName: str('COOKIE_NAME', 'boozie_session'),
  /**
   * Leave these alone for a LAN / Tailscale setup over plain HTTP. When the
   * frontend is hosted on a different origin (Cloudflare Pages) over HTTPS,
   * set COOKIE_SAMESITE=none and COOKIE_SECURE=true so the cookie is allowed
   * to travel cross-site.
   */
  cookieSameSite: (() => {
    const value = str('COOKIE_SAMESITE', 'lax').toLowerCase();
    return (['lax', 'strict', 'none'].includes(value) ? value : 'lax') as 'lax' | 'strict' | 'none';
  })(),
  cookieSecure: bool('COOKIE_SECURE', str('COOKIE_SAMESITE', 'lax').toLowerCase() === 'none'),

  minPasswordLength: int('MIN_PASSWORD_LENGTH', 8),

  /** Failed logins allowed per username+IP inside the window below. */
  loginMaxAttempts: int('LOGIN_MAX_ATTEMPTS', 10),
  loginWindowMinutes: int('LOGIN_WINDOW_MINUTES', 15),

  /**
   * Which proxies may set X-Forwarded-For.
   *
   * `true` would trust the header from ANY client, letting anyone forge their
   * IP and slip past the login throttle. cloudflared and Tailscale Funnel both
   * connect over the loopback interface, so trusting only that is correct and
   * safe. Set TRUST_PROXY to a comma-separated list of CIDRs for other setups,
   * or to `false` when nothing sits in front of the server.
   */
  trustProxy: (() => {
    const value = str('TRUST_PROXY', 'loopback');
    if (value === 'false') return false;
    if (value === 'loopback') return '127.0.0.1, ::1';
    return value;
  })(),

  // --- social features ----------------------------------------------------

  /** Messages one account may send per minute. */
  messageRatePerMinute: int('MESSAGE_RATE_PER_MINUTE', 30),
  /** Maximum characters in a direct message. */
  messageMaxLength: int('MESSAGE_MAX_LENGTH', 2000),
  /** Friend requests one account may send per hour. */
  friendRequestsPerHour: int('FRIEND_REQUESTS_PER_HOUR', 30),

  /**
   * GIF / emoji search keys. Searches are proxied through this server so the
   * keys never reach the browser and the provider never sees a visitor's IP.
   * Without a key the picker simply reports that search is unavailable.
   */
  giphyApiKey: str('GIPHY_API_KEY', ''),
  tenorApiKey: str('TENOR_API_KEY', ''),
  /** emoji.gg needs no key; set to false to hide that tab. */
  emojiGgEnabled: bool('EMOJI_GG_ENABLED', true),
} as const;

/**
 * Hosts that may be referenced by a message attachment or an avatar.
 *
 * Rendering a remote image leaks the viewer's IP to whoever serves it, so the
 * set is limited to the providers the picker actually searches. Anything else
 * is rejected at write time, which also stops someone pointing an avatar at an
 * internal address to probe the network from other people's browsers.
 */
export const ALLOWED_MEDIA_HOSTS = new Set([
  'media.giphy.com',
  'media0.giphy.com',
  'media1.giphy.com',
  'media2.giphy.com',
  'media3.giphy.com',
  'media4.giphy.com',
  'i.giphy.com',
  'media.tenor.com',
  'c.tenor.com',
  'emoji.gg',
  'cdn.emoji.gg',
  'cdn3.emoji.gg',
]);

/** True when a URL is an https link to one of the allowed media hosts. */
export function isAllowedMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ALLOWED_MEDIA_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Avatars are either uploaded here — a same-origin `/api/avatar/<file>` path —
 * or a URL from the allowlisted providers. Anything else is refused, so nobody
 * can point an avatar at an arbitrary host and log every viewer's IP.
 */
export function isAllowedAvatarUrl(value: string): boolean {
  if (/^\/api\/avatar\/[A-Za-z0-9_-]{1,80}\.(png|jpg|jpeg|gif|webp)$/.test(value)) return true;
  return isAllowedMediaUrl(value);
}

/** Audio extensions we index. Everything here is supported by music-metadata. */
export const AUDIO_EXTENSIONS = new Set([
  'mp3',
  'flac',
  'm4a',
  'm4b',
  'mp4',
  'aac',
  'opus',
  'ogg',
  'oga',
  'wav',
  'wave',
  'aiff',
  'aif',
  'aifc',
  'wma',
  'wv',
  'ape',
  'mpc',
  'dsf',
  'dff',
  'alac',
  'spx',
]);

/** Content types used for streaming and downloads. */
export const MIME_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  m4b: 'audio/mp4',
  mp4: 'audio/mp4',
  alac: 'audio/mp4',
  aac: 'audio/aac',
  opus: 'audio/ogg',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  spx: 'audio/ogg',
  wav: 'audio/wav',
  wave: 'audio/wav',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  aifc: 'audio/aiff',
  wma: 'audio/x-ms-wma',
  wv: 'audio/x-wavpack',
  ape: 'audio/x-monkeys-audio',
  mpc: 'audio/x-musepack',
  dsf: 'audio/x-dsf',
  dff: 'audio/x-dff',
};

/** Formats that are lossless (used for the "HI-RES / LOSSLESS" badges). */
export const LOSSLESS_EXTENSIONS = new Set([
  'flac',
  'wav',
  'wave',
  'aiff',
  'aif',
  'aifc',
  'alac',
  'wv',
  'ape',
  'dsf',
  'dff',
]);

/** Image filenames treated as album art, in priority order. */
export const COVER_FILENAMES = [
  'cover',
  'folder',
  'front',
  'albumart',
  'album',
  'artwork',
  'thumb',
  'scan',
];

export const COVER_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'];
