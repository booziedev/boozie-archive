/** Small text helpers shared by the scanner and the query layer. */

/** Trims, collapses whitespace and returns null for empty strings. */
export function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Turns a filename into a readable title:
 * "03 - Artist - My Song.flac" -> "My Song" is too aggressive, so we only strip
 * a leading track number and the extension: "03 - My Song" -> "My Song".
 */
export function titleFromFilename(filename: string): string {
  const withoutExt = filename.replace(/\.[^.]+$/, '');
  const stripped = withoutExt
    .replace(/^\s*\d{1,3}\s*[-._)]\s*/, '')
    .replace(/^\s*\d{1,3}\s+/, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length > 0 ? stripped : withoutExt;
}

/**
 * Album folders are often named "1997 - OK Computer" or "[1997] OK Computer".
 * Returns the album name plus the year when one can be recovered.
 */
export function parseAlbumFolder(folderName: string): { name: string; year: number | null } {
  const patterns: RegExp[] = [
    /^\s*[\[(]?(?<year>(?:19|20)\d{2})[\])]?\s*[-–_.]\s*(?<name>.+)$/,
    /^\s*(?<name>.+?)\s*[\[(](?<year>(?:19|20)\d{2})[\])]\s*$/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(folderName);
    if (match?.groups) {
      const year = Number.parseInt(match.groups.year!, 10);
      const name = match.groups.name!.trim();
      if (name) return { name, year: Number.isFinite(year) ? year : null };
    }
  }
  return { name: folderName.replace(/_/g, ' ').trim(), year: null };
}

/** Splits multi-value genre tags ("Rock; Indie" / "Rock/Indie") into a list. */
export function splitGenres(values: string[] | undefined): string[] {
  if (!values || values.length === 0) return [];
  const out = new Set<string>();
  for (const raw of values) {
    for (const part of String(raw).split(/[;,/]|\s+\|\s+/)) {
      const value = clean(part);
      if (value) out.add(value);
    }
  }
  return [...out];
}

/** Case-insensitive "contains" used by every search endpoint. */
export function foldForSearch(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
