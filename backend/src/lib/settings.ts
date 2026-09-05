import { pool } from '../db/pool.js';

/**
 * Runtime site settings an admin can flip without a restart: maintenance mode
 * and the global announcement.
 *
 * Values are cached in memory because they are read on *every* request (the
 * maintenance gate) and written rarely. One process owns the cache, so a write
 * refreshes it directly rather than needing invalidation.
 */

export interface MaintenanceSetting {
  enabled: boolean;
  message: string;
}

export interface AnnouncementSetting {
  enabled: boolean;
  message: string;
  /** Bumped on every edit so a dismissal only hides the message it was for. */
  version: number;
  updatedAt: string | null;
}

export interface SiteSettings {
  maintenance: MaintenanceSetting;
  announcement: AnnouncementSetting;
}

const DEFAULTS: SiteSettings = {
  maintenance: {
    enabled: false,
    message: 'The archive is down for maintenance. Back shortly.',
  },
  announcement: { enabled: false, message: '', version: 0, updatedAt: null },
};

let cache: SiteSettings = structuredClone(DEFAULTS);
let loaded = false;

/** Reads both settings from the database into the cache. */
export async function loadSettings(): Promise<SiteSettings> {
  const { rows } = await pool.query<{ key: string; value: unknown }>(
    'SELECT key, value FROM app_settings',
  );

  const next = structuredClone(DEFAULTS);
  for (const row of rows) {
    if (row.key === 'maintenance') {
      const value = row.value as Partial<MaintenanceSetting>;
      next.maintenance = {
        enabled: Boolean(value?.enabled),
        message: String(value?.message ?? DEFAULTS.maintenance.message),
      };
    }
    if (row.key === 'announcement') {
      const value = row.value as Partial<AnnouncementSetting>;
      next.announcement = {
        enabled: Boolean(value?.enabled),
        message: String(value?.message ?? ''),
        version: Number(value?.version ?? 0),
        updatedAt: value?.updatedAt ? String(value.updatedAt) : null,
      };
    }
  }

  cache = next;
  loaded = true;
  return cache;
}

/** Synchronous read for the request hook; falls back to defaults before boot. */
export function getSettings(): SiteSettings {
  return cache;
}

export function settingsLoaded(): boolean {
  return loaded;
}

async function write(key: string, value: unknown, updatedBy: string): Promise<void> {
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at, updated_by)
     VALUES ($1, $2::jsonb, now(), $3)
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [key, JSON.stringify(value), updatedBy],
  );
  await loadSettings();
}

export async function setMaintenance(
  input: { enabled: boolean; message?: string },
  updatedBy: string,
): Promise<SiteSettings> {
  const message = (input.message ?? cache.maintenance.message).trim().slice(0, 500);
  await write(
    'maintenance',
    { enabled: Boolean(input.enabled), message: message || DEFAULTS.maintenance.message },
    updatedBy,
  );
  return cache;
}

export async function setAnnouncement(
  input: { enabled: boolean; message: string },
  updatedBy: string,
): Promise<SiteSettings> {
  const message = String(input.message ?? '').trim().slice(0, 500);
  await write(
    'announcement',
    {
      // An empty message is the same as switching it off.
      enabled: Boolean(input.enabled) && message.length > 0,
      message,
      version: cache.announcement.version + 1,
      updatedAt: new Date().toISOString(),
    },
    updatedBy,
  );
  return cache;
}
