import crypto from 'node:crypto';

/**
 * Short, stable, URL-safe id derived from a string.
 *
 * Ids must survive a rescan so that favourites, shared links and cached cover
 * URLs keep working: they are therefore derived from stable content (the
 * relative file path for tracks, the normalised name for artists/albums)
 * rather than from an incrementing counter.
 */
export function hashId(prefix: string, value: string): string {
  const digest = crypto.createHash('sha1').update(value).digest('base64url');
  return `${prefix}${digest.slice(0, 16)}`;
}

/** Case/whitespace-insensitive key used to merge tag spelling variants. */
export function normalizeKey(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function artistId(name: string): string {
  return hashId('ar_', normalizeKey(name));
}

export function albumId(artistName: string, albumName: string): string {
  return hashId('al_', `${normalizeKey(artistName)}::${normalizeKey(albumName)}`);
}

export function trackId(relativePath: string): string {
  return hashId('tr_', relativePath);
}
