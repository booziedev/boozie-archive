/**
 * Runtime configuration.
 *
 * The API base URL normally comes from `VITE_API_BASE_URL` at build time, but
 * it can be overridden at runtime from the Settings page and stored in
 * localStorage. That means a Cloudflare Tunnel URL change (or pointing the
 * hosted frontend at a LAN address while at home) needs no redeploy.
 */
const STORAGE_KEY = 'boozie.apiBaseUrl';

const BUILD_TIME_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').trim();

function readOverride(): string {
  try {
    return localStorage.getItem(STORAGE_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}

/** Strips a trailing slash so `${base}/api/...` never doubles up. */
export function normalizeBase(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function getApiBaseUrl(): string {
  return normalizeBase(readOverride() || BUILD_TIME_BASE);
}

export function setApiBaseUrl(value: string) {
  const normalized = normalizeBase(value);
  try {
    if (normalized) localStorage.setItem(STORAGE_KEY, normalized);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode / storage disabled — the build-time value still applies.
  }
}

export function getConfiguredBaseUrl(): string {
  return normalizeBase(BUILD_TIME_BASE);
}

export function hasApiOverride(): boolean {
  return readOverride().length > 0;
}

export const siteName = (import.meta.env.VITE_SITE_NAME ?? 'BOOZIE ARCHIVE').trim();
export const siteTagline = (
  import.meta.env.VITE_SITE_TAGLINE ?? 'A personal, lossless-first music vault.'
).trim();

/** Absolute URL for an API path, e.g. apiUrl('/api/stats'). */
export function apiUrl(path: string): string {
  const base = getApiBaseUrl();
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}
