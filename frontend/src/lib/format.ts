/** Formatting helpers shared across the UI. */

/** 245 -> "4:05", 3725 -> "1:02:05". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return '--:--';
  }
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

/** Long-form runtime for headers: "12 hr 4 min". */
export function formatRuntime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 min';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} d ${hours} hr`;
  if (hours > 0) return `${hours} hr ${minutes} min`;
  if (minutes > 0) return `${minutes} min`;
  return `${Math.round(seconds)} sec`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 100 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined).format(value);
}

/**
 * Short technical badge for a track: "FLAC 24/96", "MP3 320", "OPUS".
 * Mirrors what a well-tagged collection actually shows in a file browser.
 */
export function qualityLabel(track: {
  ext: string;
  lossless: boolean;
  bitrate: number | null;
  sampleRate: number | null;
  bitsPerSample: number | null;
}): string {
  const format = track.ext.toUpperCase();
  if (track.lossless) {
    const bits = track.bitsPerSample ? `${track.bitsPerSample}` : null;
    const khz = track.sampleRate ? `${+(track.sampleRate / 1000).toFixed(1)}` : null;
    if (bits && khz) return `${format} ${bits}/${khz}`;
    if (khz) return `${format} ${khz}kHz`;
    return format;
  }
  if (track.bitrate) return `${format} ${Math.round(track.bitrate / 1000)}`;
  return format;
}

/** True for anything above CD quality — used for the "HI-RES" badge. */
export function isHiRes(track: {
  lossless: boolean;
  sampleRate: number | null;
  bitsPerSample: number | null;
}): boolean {
  if (!track.lossless) return false;
  return (track.sampleRate ?? 0) > 48000 || (track.bitsPerSample ?? 0) > 16;
}

export function formatDate(value: string | number | null): string {
  if (!value) return 'never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Deterministic gradient for entities without artwork, so a given album always
 * gets the same placeholder colour instead of flickering between renders.
 */
export function gradientFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  const hue2 = (hue + 48) % 360;
  return `linear-gradient(135deg, hsl(${hue} 55% 26%) 0%, hsl(${hue2} 50% 12%) 60%, hsl(${hue} 40% 8%) 100%)`;
}

/** Two-letter monogram used inside placeholder tiles. */
export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/);
  if (words.length === 0 || !words[0]) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] ?? ''}${words[1]?.[0] ?? ''}`.toUpperCase();
}
