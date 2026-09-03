import path from 'node:path';

/**
 * Joins a user-supplied relative path onto a root directory, returning null if
 * the result would escape it. Every filesystem read goes through this, even
 * though paths come from the index rather than the request, so a corrupted or
 * hand-edited index can never be used to read outside the library.
 */
export function safeJoin(root: string, relative: string): string | null {
  if (!relative) return null;
  const normalizedRoot = path.resolve(root);
  const target = path.resolve(normalizedRoot, relative.split('/').join(path.sep));
  const withSep = normalizedRoot.endsWith(path.sep) ? normalizedRoot : normalizedRoot + path.sep;
  if (target !== normalizedRoot && !target.startsWith(withSep)) return null;
  return target;
}

/**
 * RFC 5987 / RFC 6266 Content-Disposition value that survives non-ASCII
 * filenames (accents, CJK, emoji all show up in real collections).
 */
export function contentDisposition(filename: string, type: 'inline' | 'attachment'): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
