import fsp from 'node:fs/promises';
import path from 'node:path';

/**
 * Which frontend build is actually being served.
 *
 * "I pulled and restarted but the page looks the same" has one cause almost
 * every time: the server is still handing out an older `frontend/dist`, either
 * because the build didn't run, it failed part-way, or the browser is holding a
 * cached shell. None of that is visible from the page itself, so the server
 * reports what it loaded — the directory, when it was built, and the name of the
 * bundle it will serve. Comparing that bundle name with the one the browser
 * actually requested settles the question in one step.
 */
export interface FrontendBuild {
  dir: string;
  /** Modification time of the built index.html. */
  builtAt: string | null;
  /** The hashed entry bundle, e.g. `index-BTqtCQrL.js`. */
  bundle: string | null;
}

let current: FrontendBuild | null = null;

export function frontendBuild(): FrontendBuild | null {
  return current;
}

/** Reads the build's identity once, at boot. */
export async function describeFrontendBuild(dir: string): Promise<FrontendBuild> {
  const indexPath = path.join(dir, 'index.html');

  let builtAt: string | null = null;
  let bundle: string | null = null;

  try {
    const [stat, html] = await Promise.all([fsp.stat(indexPath), fsp.readFile(indexPath, 'utf8')]);
    builtAt = stat.mtime.toISOString();
    // Vite writes exactly one module entry into the shell; its hash changes on
    // every build whose output differs, which is what makes it a version.
    bundle = /<script[^>]+src="\/assets\/(index-[^"]+\.js)"/.exec(html)?.[1] ?? null;
  } catch {
    // A missing or unreadable shell is reported by the caller; leave the fields
    // null rather than failing a boot that is otherwise fine.
  }

  current = { dir, builtAt, bundle };
  return current;
}
