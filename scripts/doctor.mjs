#!/usr/bin/env node
/**
 * `npm run doctor` — checks everything that stands between a fresh clone and a
 * working archive at http://<pi>:1981/, and prints the exact fix for whatever
 * is missing. Dependency-free so it runs before (and after) any install.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

function ok(label, detail = '') {
  console.log(`  ${green('✓')} ${label}${detail ? dim(`  ${detail}`) : ''}`);
}
function bad(label, fix) {
  console.log(`  ${red('✗')} ${label}`);
  if (fix) console.log(`      ${yellow('fix:')} ${fix}`);
  problems.push(label);
}
function warn(label, detail = '') {
  console.log(`  ${yellow('!')} ${label}${detail ? dim(`  ${detail}`) : ''}`);
}

function exists(p) {
  try {
    return fs.statSync(p).isFile() || fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Minimal .env reader — no dependencies, good enough for KEY=value lines. */
function readEnv(file) {
  const env = {};
  if (!exists(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '').trim();
  }
  return env;
}

console.log(`\nboozie-archive doctor  ${dim(repoRoot)}\n`);

// --- toolchain -------------------------------------------------------------
console.log('Toolchain');
const major = Number.parseInt(process.versions.node.split('.')[0], 10);
if (major >= 20) ok(`Node ${process.versions.node}`);
else bad(`Node ${process.versions.node} is too old (need 20+)`, 'curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs');

// --- builds ----------------------------------------------------------------
console.log('\nBuilds');
const backendEntry = path.join(repoRoot, 'backend', 'dist', 'index.js');
if (exists(backendEntry)) ok('backend built', 'backend/dist/index.js');
else bad('backend is NOT built', 'npm --prefix backend install && npm --prefix backend run build');

const frontendIndex = path.join(repoRoot, 'frontend', 'dist', 'index.html');
if (exists(frontendIndex)) {
  const built = fs.statSync(frontendIndex).mtime.toISOString().replace('T', ' ').slice(0, 16);
  ok('frontend built', `frontend/dist  (built ${built})`);
} else {
  bad(
    'frontend is NOT built — this is why you get JSON instead of the web app',
    'npm --prefix frontend install && npm --prefix frontend run build',
  );
  if (!exists(path.join(repoRoot, 'frontend', 'node_modules'))) {
    console.log(`      ${dim('frontend/node_modules is missing too — run `npm run setup` in the repo root.')}`);
  }
}

// --- baked-in API URL ------------------------------------------------------
// A stale VITE_API_BASE_URL is the other way the app looks broken: it loads,
// but every request goes to a host the phone can't reach.
if (exists(frontendIndex)) {
  const assetsDir = path.join(repoRoot, 'frontend', 'dist', 'assets');
  let baked = null;
  if (exists(assetsDir)) {
    for (const file of fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js'))) {
      const text = fs.readFileSync(path.join(assetsDir, file), 'utf8');
      const match = /VITE_API_BASE_URL[^"']*["'](https?:\/\/[^"']+)["']/.exec(text)
        ?? /["'](https?:\/\/[^"']*:1981)["']/.exec(text);
      if (match) { baked = match[1]; break; }
    }
  }
  if (!baked) ok('frontend calls /api on its own origin', 'VITE_API_BASE_URL empty — correct for a Pi-hosted app');
  else if (/localhost|127\.0\.0\.1/.test(baked)) {
    bad(
      `frontend was built with VITE_API_BASE_URL=${baked} — on a phone that means the phone itself`,
      'rm -f frontend/.env  (or blank the value), then rebuild: npm --prefix frontend run build',
    );
  } else warn(`frontend targets ${baked}`, 'intentional only if the API really lives there');
}

// --- backend config --------------------------------------------------------
console.log('\nBackend config');
const env = readEnv(path.join(repoRoot, 'backend', '.env'));
if (!exists(path.join(repoRoot, 'backend', '.env'))) {
  warn('backend/.env not found', 'defaults apply: MUSIC_ROOT=/home/admin/ssd/mediausb/music/, PORT=1981');
}

const port = env.PORT || '1981';
ok(`port ${port}`, env.PORT ? 'from backend/.env' : 'default');

const musicRoot = env.MUSIC_ROOT || '/home/admin/ssd/mediausb/music/';
if (exists(musicRoot)) {
  try {
    fs.accessSync(musicRoot, fs.constants.R_OK);
    ok(`music root readable`, musicRoot);
  } catch {
    bad(`music root exists but is not readable by ${process.env.USER ?? 'this user'}`, `sudo chmod -R a+rX ${musicRoot}`);
  }
} else {
  bad(`music root not found: ${musicRoot}`, 'set MUSIC_ROOT in backend/.env to your collection path');
}

if (env.SERVE_FRONTEND && !['1', 'true', 'yes', 'on'].includes(env.SERVE_FRONTEND.toLowerCase())) {
  bad('SERVE_FRONTEND is off, so the API will never serve the web app', 'remove SERVE_FRONTEND from backend/.env (or set it to true)');
}
if (env.FRONTEND_DIST) {
  if (exists(path.join(env.FRONTEND_DIST, 'index.html'))) ok('FRONTEND_DIST override valid', env.FRONTEND_DIST);
  else bad(`FRONTEND_DIST points at ${env.FRONTEND_DIST}, which has no index.html`, 'unset FRONTEND_DIST in backend/.env to use the default lookup');
}

const dataDir = env.DATA_DIR || path.join(repoRoot, 'backend', 'data');
try {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.accessSync(dataDir, fs.constants.W_OK);
  ok('data dir writable', dataDir);
} catch {
  bad(`data dir not writable: ${dataDir}`, `mkdir -p ${dataDir} && sudo chown -R $USER ${dataDir}`);
}

// --- accounts / database ---------------------------------------------------
console.log('\nAccounts');
const authEnabled = !env.AUTH_ENABLED || ['1', 'true', 'yes', 'on'].includes(env.AUTH_ENABLED.toLowerCase());

if (!authEnabled) {
  warn('AUTH_ENABLED=false', 'the archive is open to anyone who can reach it');
} else {
  const url = env.DATABASE_URL || 'postgres://boozie:boozie@localhost:5432/boozie_archive';
  const redacted = url.replace(/:[^:@/]*@/, ':***@');
  if (!env.DATABASE_URL) {
    warn('DATABASE_URL not set in backend/.env', `falling back to ${redacted}`);
  } else if (/CHANGE_ME/.test(url)) {
    bad('DATABASE_URL still contains the CHANGE_ME placeholder', 'set a real password — see POSTGRES.md step 2');
  } else {
    ok('DATABASE_URL set', redacted);
  }

  // Characters that change the meaning of a URL cannot appear raw in a password.
  // `/` and `%` break parsing outright; the rest silently truncate it.
  const passwordMatch = /^[a-z]+:\/\/[^:/@]+:([^@]*)@/i.exec(url);
  const rawPassword = passwordMatch?.[1] ?? '';
  const risky = [...new Set([...rawPassword].filter((c) => '/%@?#[]'.includes(c)))];
  if (risky.length > 0) {
    bad(
      `the password in DATABASE_URL contains ${risky.map((c) => `"${c}"`).join(', ')}, which URLs treat as syntax`,
      'use a URL-safe password: sudo -u postgres psql -c "ALTER ROLE boozie WITH PASSWORD \'$(openssl rand -hex 24)\';" then put the same value in DATABASE_URL',
    );
  }

  // Connect for real. This is the check that actually answers "why won't it
  // start" — the server's own failure is the same connection with the same URL.
  let pg = null;
  try {
    pg = (await import(path.join(repoRoot, 'backend', 'node_modules', 'pg', 'lib', 'index.js'))).default;
  } catch {
    warn('cannot test the connection', 'backend dependencies are not installed yet');
  }

  if (pg) {
    const failure = await new Promise((resolve) => {
      let pool;
      try {
        pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 5000, max: 1 });
      } catch (error) {
        resolve(error);
        return;
      }
      pool
        .query('SELECT 1')
        .then(() => resolve(null))
        .catch(resolve)
        .finally(() => pool.end().catch(() => undefined));
    });

    if (!failure) {
      ok('connected to PostgreSQL with these credentials');
    } else {
      const code = failure.code ?? failure.name;
      const fixes = {
        // PostgreSQL reports a missing role and a wrong password identically,
        // on purpose — so the fix has to cover both.
        '28P01':
          'the password is wrong, or that role does not exist. Set both from scratch:\n' +
          '        sudo -u postgres psql -c "CREATE ROLE boozie WITH LOGIN PASSWORD \'a-new-password\';"  # if missing\n' +
          '        sudo -u postgres psql -c "ALTER ROLE boozie WITH PASSWORD \'a-new-password\';"        # if it exists\n' +
          '        then put exactly that password in DATABASE_URL and re-run this check',
        // Role missing, or pg_hba.conf refuses this method.
        '28000':
          'the role does not exist or pg_hba.conf rejects it:\n' +
          '        sudo -u postgres psql -c "CREATE ROLE boozie WITH LOGIN PASSWORD \'a-new-password\';"',
        '3D000':
          'the database does not exist:\n' +
          '        sudo -u postgres psql -c "CREATE DATABASE boozie_archive OWNER boozie;"',
        '42501':
          'grant the schema to the role:\n' +
          '        sudo -u postgres psql -d boozie_archive -c "ALTER DATABASE boozie_archive OWNER TO boozie; GRANT ALL ON SCHEMA public TO boozie;"',
        ECONNREFUSED: 'PostgreSQL is not running or not listening there: sudo systemctl start postgresql',
        ENOTFOUND: 'the host in DATABASE_URL does not resolve — use 127.0.0.1 for a local server',
        ETIMEDOUT: 'the host is unreachable — check the host and port in DATABASE_URL',
        ERR_INVALID_URL: 'DATABASE_URL is not a valid URL — a "/" or "%" in the password will do this',
        URIError: 'DATABASE_URL contains an invalid percent-escape — avoid "%" in the password',
      };
      bad(
        `PostgreSQL refused the connection (${code}): ${failure.message}`,
        fixes[code] ?? 'see POSTGRES.md',
      );
    }
  }

  // Ask the running server rather than opening our own connection: it is the
  // process whose credentials actually matter.
  const context = await new Promise((resolve) => {
    const request = http.get(
      { host: '127.0.0.1', port: Number(port), path: '/api/auth/context', timeout: 3000 },
      (response) => {
        let data = '';
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve(null); }
        });
      },
    );
    request.on('timeout', () => { request.destroy(); resolve(null); });
    request.on('error', () => resolve(null));
  });

  if (!context) {
    warn('could not ask the server about accounts', 'is it running? pm2 start ecosystem.config.cjs');
  } else if (context.authEnabled === false) {
    warn('the running server has accounts disabled', 'it was started with AUTH_ENABLED=false');
  } else if (context.needsSetup) {
    ok('database connected, no accounts yet', `open http://<pi>:${port}/ to create the admin account`);
  } else {
    ok('database connected, accounts exist');
  }
}

// --- live server -----------------------------------------------------------
console.log('\nRunning server');
const body = await new Promise((resolve) => {
  const request = http.get({ host: '127.0.0.1', port: Number(port), path: '/', timeout: 3000 }, (response) => {
    let data = '';
    response.on('data', (chunk) => { data += chunk; if (data.length > 4096) request.destroy(); });
    response.on('end', () => resolve({ status: response.statusCode, type: response.headers['content-type'] ?? '', data }));
  });
  request.on('timeout', () => { request.destroy(); resolve(null); });
  request.on('error', () => resolve(null));
});

if (!body) {
  warn(`nothing responding on port ${port}`, 'start it: pm2 start ecosystem.config.cjs   (or npm start)');
} else if (body.type.includes('text/html')) {
  ok(`serving the web app on port ${port}`, `open http://<this-machine>:${port}/`);
} else if (body.type.includes('json')) {
  bad(
    `port ${port} is serving the API only — the web app build was not found`,
    'npm run setup   then restart: pm2 restart boozie-archive-api',
  );
  try {
    const parsed = JSON.parse(body.data);
    if (parsed.checked) {
      console.log(`      ${dim('the running server checked:')}`);
      for (const dir of parsed.checked) console.log(`        ${dim('- ' + dir)}`);
      console.log(`      ${dim('if your build is elsewhere, set FRONTEND_DIST in backend/.env')}`);
    }
  } catch {
    // Older build without the `checked` field — the advice above still applies.
  }
} else {
  warn(`port ${port} replied ${body.status} (${body.type})`);
}

console.log(
  problems.length === 0
    ? `\n${green('All good.')} Open http://<pi-address>:${port}/ in Safari.\n`
    : `\n${red(`${problems.length} problem(s) found`)} — apply the fixes above, then run this again.\n`,
);
process.exit(problems.length === 0 ? 0 : 1);
