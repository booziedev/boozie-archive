# Boozie Archive

A personal music archive: a **Fastify + TypeScript** server that indexes and streams a music
collection from a Raspberry Pi, and a **React + TypeScript + Vite** single-page app that browses it.
The frontend is a pure static build, so it can be hosted for free on Cloudflare Pages, Vercel or
Netlify, and reaches the Pi over a free HTTPS tunnel.

- Browse by **artist → album → track**, or search every track flat
- **In-browser playback** with real seeking (HTTP range requests) and a queue
- **Direct download** of any file, untouched
- **Full embedded metadata** read with [`music-metadata`](https://github.com/Borewit/music-metadata)
- **Cover art** from embedded tags or `cover.jpg` / `folder.jpg` next to the audio
- **Favourites** stored on the device, **filters** by genre, year, format
- **Invite-only accounts** backed by PostgreSQL, with a Discord-style admin panel
  for issuing, expiring and disabling invite codes
- **Friends and private messages**, with GIF/emoji support and one-tap sharing of
  any album, artist or track into a conversation
- **Profiles** with animated GIF avatars, a display name, bio and accent colour
- Installable from **Safari on iOS** as a full-screen app with lock-screen controls

---

## Table of contents

1. [Architecture](#architecture)
2. [Quick start (local)](#quick-start-local)
3. [Backend on the Raspberry Pi](#backend-on-the-raspberry-pi)
4. [Running it as a service](#running-it-as-a-service)
5. [Exposing it publicly for free](#exposing-it-publicly-for-free)
6. [Serving the frontend](#serving-the-frontend)
7. [Accounts and invites](#accounts-and-invites)
8. [Friends, messages and profiles](#friends-messages-and-profiles)
9. [Installing on iOS](#installing-on-ios)
10. [How metadata scanning works](#how-metadata-scanning-works)
11. [Environment variables](#environment-variables)
12. [API reference](#api-reference)
13. [Project structure](#project-structure)
14. [Troubleshooting](#troubleshooting) — start with `npm run doctor`

---

## Architecture

There are two ways to run it. **Both are free** — pick one.

**A. One box, one port (simplest).** The Pi serves the web app *and* the API from the same
process, so there is one tunnel, one URL and no CORS to think about. This is the default: if
`frontend/dist` exists, the backend serves it at `/`.

```
  iPhone / laptop                              Raspberry Pi 5
 ┌────────────────┐                       ┌──────────────────────────────┐
 │  Safari / PWA  │ ──── HTTPS ─────────▶ │  Fastify  :1981              │
 │                │  (cloudflared /       │  ├─ /            web app     │
 │                │   Tailscale Funnel)   │  ├─ /api/…       metadata    │
 │                │                       │  ├─ /api/stream  audio       │
 └────────────────┘                       │  ├─ PostgreSQL   accounts    │
                                          │  └─ /home/admin/ssd/…/music/ │
                                          └──────────────────────────────┘
```

**B. Static host + Pi API.** The frontend goes on Cloudflare Pages / Vercel / Netlify and calls the
Pi across origins. Slightly faster page loads worldwide, one more thing to configure.

```
  iPhone / laptop                Cloudflare Pages              Raspberry Pi 5
 ┌────────────────┐            ┌──────────────────┐        ┌────────────────────────┐
 │  Safari / PWA  │ ── HTML ─▶ │  static frontend │        │  Fastify API  :1981    │
 │                │            │  (dist/, free)   │        │  ├─ scanner (music-    │
 │                │            └──────────────────┘        │  │   metadata)         │
 │                │                                        │  ├─ JSON index + cover │
 │                │ ──── HTTPS /api/... ──────────────────▶ │  │   cache (DATA_DIR)  │
 │                │      (cloudflared / Tailscale)         │  └─ /home/admin/ssd/   │
 └────────────────┘                                        │     mediausb/music/    │
                                                           └────────────────────────┘
```

The backend keeps the whole library in memory as three flat arrays (artists, albums, tracks) plus
lookup maps, and persists that index as one JSON file. Queries never touch the disk; only streaming,
downloads and first-time cover extraction do.

---

## Quick start (local)

Requires **Node.js 20+**.

```bash
git clone https://github.com/booziedev/boozie-archive.git
cd boozie-archive
npm run install:all

# --- backend ---
cp backend/.env.example backend/.env
#   edit backend/.env: point MUSIC_ROOT at your collection, and set DATABASE_URL
#   (see POSTGRES.md — or set AUTH_ENABLED=false to run without accounts)
npm run dev:backend          # http://localhost:1981

# --- frontend (second terminal) ---
cp frontend/.env.example frontend/.env
npm run dev:frontend         # http://localhost:5173
```

The dev server proxies `/api` to `http://localhost:1981`, so `VITE_API_BASE_URL` can be left empty
while developing locally.

For a production-like check on one port, build instead of running the dev server — `npm run build`,
then `npm start` — and open `http://localhost:1981/`, where the backend serves the built app itself.

Check the whole setup at any time:

```bash
npm run doctor      # toolchain, builds, config, music root, and what port 1981 is actually serving
```

Verify the backend on its own:

```bash
curl localhost:1981/api/health
curl localhost:1981/api/stats
curl -H 'Range: bytes=0-1' -D - -o /dev/null localhost:1981/api/stream/<track-id>   # expect 206
```

---

## Backend on the Raspberry Pi

Tested on Raspberry Pi OS (64-bit, Bookworm) on a Pi 5 with the collection on an SSD.

### 1. Install Node 20+

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git
node -v      # v20.x or newer
```

### 2. Get the code and build

```bash
cd ~
git clone https://github.com/booziedev/boozie-archive.git
cd boozie-archive
npm run install:all          # backend + frontend dependencies
npm run build                # compiles the backend AND builds the web app
```

`npm run build` produces `backend/dist/` (the server) and `frontend/dist/` (the web app). The server
serves that web app automatically, so **`http://<pi>:1981/` gives you the full interface**, not just
JSON. If you only want the API — because you're hosting the frontend on Cloudflare Pages — skip the
frontend build or set `SERVE_FRONTEND=false`.

To build only the backend:

```bash
npm --prefix backend install && npm --prefix backend run build
```

> `sharp` is an **optional** dependency. If it fails to install (no prebuilt binary for your
> platform), the server still runs — it just serves original cover images instead of resized
> thumbnails.

### 3. Configure

```bash
cp .env.example .env
nano .env
```

The values that matter:

```ini
MUSIC_ROOT=/home/admin/ssd/mediausb/music/
PORT=1981
DATA_DIR=/home/admin/boozie-archive/backend/data
CORS_ORIGINS=*
ADMIN_TOKEN=$(openssl rand -hex 32)      # paste the generated value
```

Make sure the service user can read the music and write `DATA_DIR`:

```bash
ls -ld /home/admin/ssd/mediausb/music/
mkdir -p /home/admin/boozie-archive/backend/data
```

### 4. First scan

```bash
npm run start          # scans at boot, serves while it works
# or, to scan without starting the server:
npm run scan
```

A cold scan reads tags from every file: expect roughly **10–25 minutes for 100 GB** on a Pi 5 with an
SSD. Every later scan only re-reads files whose size or mtime changed, so restarts take seconds.
The index is written to `$DATA_DIR/library-index.json`, cover thumbnails to `$DATA_DIR/covers/`.

Then open **`http://<pi-address>:1981/`** in a browser on the same network — you should get the
archive UI. `http://<pi-address>:1981/api/stats` still returns the raw JSON.

Trigger a rescan later without restarting:

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:1981/api/rescan
# add ?covers=clear to also drop the cover cache
```

---

## Running it as a service

Pick **one** of the two — don't run both against the same port.

### Option A — pm2 (included `ecosystem.config.cjs`)

```bash
sudo npm install -g pm2
cd ~/boozie-archive
npm --prefix backend run build

pm2 start ecosystem.config.cjs        # production: runs backend/dist/index.js on :1981
pm2 logs boozie-archive-api
pm2 save
pm2 startup                            # prints a command — run it to survive reboots
```

Useful commands:

```bash
pm2 restart boozie-archive-api
pm2 stop boozie-archive-api
pm2 monit
pm2 start ecosystem.config.cjs --env development   # run TS sources via tsx instead of dist/
```

The app is capped at one instance on purpose: the library index lives in the process's memory, and
a second worker would duplicate it and scan the collection twice.

### Option B — systemd (included `deploy/boozie-archive.service`)

```bash
sudo cp deploy/boozie-archive.service /etc/systemd/system/
sudo nano /etc/systemd/system/boozie-archive.service   # check User, paths, RequiresMountsFor
sudo systemctl daemon-reload
sudo systemctl enable --now boozie-archive
journalctl -u boozie-archive -f
```

`RequiresMountsFor=/home/admin/ssd/mediausb` makes systemd wait for the drive holding the collection,
so the service never starts against an empty mount point after a reboot.

### Optional: scheduled rescan from cron

`SCAN_INTERVAL_MINUTES` already rescans in-process. If you'd rather drive it externally:

```bash
crontab -e
# every night at 04:00
0 4 * * * curl -fsS -X POST -H "Authorization: Bearer <token>" http://localhost:1981/api/rescan
```

---

## Exposing it publicly for free

The backend listens on plain HTTP on the LAN. Put one of these in front of it for a free public
HTTPS URL — no port forwarding, no domain purchase, no hosting bill.

### Option A — Cloudflare Tunnel (`cloudflared`)

**Quick tunnel** (zero setup, random `*.trycloudflare.com` URL that changes on every restart — good
for testing):

```bash
curl -L -o cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
sudo dpkg -i cloudflared.deb
cloudflared tunnel --url http://localhost:1981
```

**Named tunnel** (stable URL, survives reboots — what you want in the end). Requires a domain on
Cloudflare; a free `.pages.dev` site does *not* provide one, but any domain you already own can be
moved onto Cloudflare's free plan:

```bash
cloudflared tunnel login                       # opens a browser to authorise
cloudflared tunnel create boozie-archive       # writes ~/.cloudflared/<UUID>.json

# route a hostname at the tunnel
cloudflared tunnel route dns boozie-archive music-api.example.com
```

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: boozie-archive
credentials-file: /home/admin/.cloudflared/<UUID>.json

ingress:
  - hostname: music-api.example.com
    service: http://localhost:1981
    originRequest:
      # Long-lived audio streams must not be cut off mid-track.
      connectTimeout: 30s
      noTLSVerify: false
  - service: http_status:404
```

Install it as a service:

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared
```

Your API base URL is then `https://music-api.example.com`.

> Cloudflare's free plan has a **100 MB upload** limit per request, which does not apply to
> downloads — streaming and downloading multi-GB files through the tunnel is fine. Note that
> proxying large amounts of non-HTML media through Cloudflare's CDN is discouraged by their terms;
> for a personal collection shared with a handful of people this is not an issue, but if you plan to
> share widely, Tailscale Funnel (below) or a direct DNS + Let's Encrypt setup is the cleaner path.

### Option B — Tailscale Funnel

Simplest if you don't own a domain: you get a free `https://<machine>.<tailnet>.ts.net` hostname.

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# expose port 1981 to the public internet over HTTPS
sudo tailscale funnel --bg 1981
sudo tailscale funnel status        # prints your public https URL
```

To make it private again (only devices on your tailnet):

```bash
sudo tailscale funnel --bg off
sudo tailscale serve --bg 1981
```

### CORS

Whichever you choose, the browser origin of the frontend must be allowed. `CORS_ORIGINS=*` (the
default) works for a public read-only archive. To lock it down:

```ini
CORS_ORIGINS=https://boozie-archive.pages.dev,http://localhost:5173
```

---

## Serving the frontend

### Option A — from the Pi itself (default, nothing to configure)

Build it once and the backend serves it:

```bash
cd ~/boozie-archive
npm run setup                         # installs both packages, builds backend + frontend
pm2 restart boozie-archive-api        # or: sudo systemctl restart boozie-archive
npm run doctor                        # confirms the app (not just the API) is being served
```

The web app is found relative to the server's own files, so it does not matter which directory pm2 or
systemd started the process from. `npm run doctor` checks every step and prints the exact fix for
whatever is missing.

Open `http://<pi-address>:1981/` — from any device on your LAN or Tailscale network. No tunnel is
needed for this; cloudflared or Funnel is only for making it public later.

If you get **JSON instead of the app**, the frontend simply hasn't been built — the server logs a
loud error at startup listing the directories it checked, the root JSON repeats it, and
`npm run doctor` names the fix. Deep links (`/albums/al_xxx`) survive a hard refresh, hashed assets
are served immutable, and `index.html` and `sw.js` are sent `no-cache` so updates land immediately.

Leave `VITE_API_BASE_URL` **empty** for this mode — the app then calls `/api` on its own origin, so
there is no CORS involved and the same tunnel covers both. After you point cloudflared or Tailscale
Funnel at port 1981, that one public URL *is* the app.

Rebuild the frontend after every `git pull`:

```bash
git pull && npm run build && pm2 restart boozie-archive-api
```

### Option B — a free static host

The build output is plain static files. Set `VITE_API_BASE_URL` to your public API URL **at build
time**, and configure the SPA fallback so deep links like `/albums/al_xxx` don't 404 (the included
`public/_redirects`, `vercel.json` and `netlify.toml` already do this). Set `SERVE_FRONTEND=false` on
the Pi if you don't want it serving a copy as well.

#### Cloudflare Pages

1. Push this repo to GitHub.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
3. Build settings:
   - **Framework preset:** Vite
   - **Build command:** `npm install && npm run build`
   - **Build output directory:** `dist`
   - **Root directory:** `frontend`
4. **Environment variables** → add `VITE_API_BASE_URL=https://music-api.example.com`
   (and optionally `VITE_SITE_NAME`, `VITE_SITE_TAGLINE`).
5. Deploy. You get `https://<project>.pages.dev` for free.

#### Vercel

Import the repo, set **Root Directory** to `frontend`, add the same environment variables. The
included `vercel.json` handles the build and the SPA rewrites.

#### Netlify

Import the repo; `frontend/netlify.toml` sets the build command, publish directory and SPA redirect.
Add `VITE_API_BASE_URL` under **Site settings → Environment variables**.

#### Manual / self-hosted

```bash
cd frontend
VITE_API_BASE_URL=https://music-api.example.com npm run build
# copy dist/ anywhere that serves static files with an index.html fallback
```

> Changing the API URL later doesn't require a redeploy: the **Settings** page in the app lets you
> override it at runtime (stored in `localStorage`), which is handy while a quick tunnel keeps
> handing out new hostnames.

---

## Accounts and invites

The archive is private by default: browsing requires an account, and creating an
account requires an invite code you issue. Credentials live in PostgreSQL on the
same Pi — **[POSTGRES.md](POSTGRES.md) is the full setup guide**, roughly five
minutes end to end.

The short version:

```bash
sudo apt install -y postgresql
sudo -u postgres psql <<'SQL'
CREATE ROLE boozie WITH LOGIN PASSWORD 'a-password-you-choose';
CREATE DATABASE boozie_archive OWNER boozie;
SQL
# then set DATABASE_URL in backend/.env and restart
```

The app creates and migrates its own tables on first start — nothing to import.

### The first account

Open the archive and you get a **Set up the archive** screen: the first account
created becomes the admin and needs no invite (there is nobody to have issued
one yet). Every account after that must redeem a code. From a terminal instead:

```bash
npm --prefix backend run admin -- yourname 'your-password'
```

That same command promotes an existing account and resets its password, which is
the way back in if you ever lock yourself out.

### Issuing invites

**Admin** in the sidebar (admins only) is a Discord-shaped invite manager:

- **Expire after** — 30 minutes, 1/6/12 hours, 1/7/30 days, or never
- **Max number of uses** — 1, 5, 10, 25, 50, 100, or unlimited
- **Label** — a private note, e.g. "discord friends"

Every code in the list shows a live countdown, a use counter (`3 / 10`) and a
status of `active`, `disabled`, `expired` or `exhausted`. The toggle disables a
code at any time without touching the accounts that already used it, and
re-enables it just as easily. The link button copies
`https://your-archive/invite/CODE`, which opens the sign-up form with the code
filled in and validated as you watch.

The accounts table below it lists everyone, which code they joined with, when
they were last seen, and lets you promote, disable or delete them. Disabling
someone signs them out everywhere immediately.

### How it's secured

- Passwords are hashed with **scrypt** (Node's built-in — no native module to
  compile on a Pi), with a random per-password salt.
- Sessions are opaque random tokens in an **httpOnly cookie**; only their
  SHA-256 is stored, so a database dump can't be replayed as a login. Cookies
  are used rather than a token in localStorage because `<audio>` and `<img>`
  cannot send an Authorization header — and the player needs credentials.
- Redeeming a code is a **single transaction with the row locked**, so two
  people racing for the last use of a code can't both get in. A failed
  registration (a taken username, say) rolls the use back.
- Failed sign-ins are throttled per username+IP; unknown usernames take the same
  time as wrong passwords, so the response doesn't reveal who exists.
- The last active admin cannot be demoted, disabled or deleted.
- If the database is unreachable the server **refuses to start**, rather than
  falling back to serving the whole archive unauthenticated.

### Options

| Want | Setting |
| --- | --- |
| No accounts at all, no database | `AUTH_ENABLED=false` |
| Anyone can browse, but joining still needs an invite | `ALLOW_PUBLIC_BROWSE=true` |
| Frontend hosted on another origin | `COOKIE_SAMESITE=none`, `COOKIE_SECURE=true`, and list the exact origin in `CORS_ORIGINS` (`*` cannot be used with cookies) |

## Friends, messages and profiles

Once people have accounts they can find each other, talk, and pass music around
without anything leaving the Pi.

**Friends.** Search the member directory by username, send a request, accept or
decline from the Friends page. Requests and unread messages show as badges in
the sidebar (and as dots in the mobile header), polled every 20 seconds.

**Direct messages.** One conversation per pair of people, with unread counts and
a two-pane layout that collapses to a single column on a phone. New messages
arrive by polling every four seconds while a thread is open — deliberately not a
websocket, because iOS drops those every time the app is backgrounded.

**Sharing.** Every album, artist and track has a **Share** button. Pick a friend,
optionally add a note, and it arrives as a rich card in the conversation that
links straight back into the archive. Nothing is made public — a share is just a
message between two people.

**GIFs and emoji.** The composer has a picker with Giphy, Tenor and emoji.gg
tabs. Searches are proxied through the Pi, so the API keys never reach the
browser and the providers never see your members' IP addresses. Add keys to
`backend/.env`:

```ini
GIPHY_API_KEY=your-key      # https://developers.giphy.com/dashboard/ (free)
TENOR_API_KEY=your-key      # optional
EMOJI_GG_ENABLED=true       # no key needed
```

Without a key that tab is simply hidden; the rest of messaging works regardless.

**Profiles.** Everyone gets a page at `/u/<username>` with a display name, bio,
accent colour and an avatar — **animated GIFs included**, picked from the same
picker. Avatars are restricted to the picker's providers so nobody can point one
at an arbitrary host and log every viewer's IP. Edit yours at `/profile`.

Messaging is friends-only, and losing a friendship closes the conversation both
ways. See [SECURITY.md](SECURITY.md) for the full model.

## Installing on iOS

1. Open the site in **Safari** (Chrome on iOS cannot install web apps).
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Launch it from the home screen — it opens full screen, with no browser chrome.

What the app does for iOS specifically:

- a single, reused `<audio>` element, so playback keeps working after the first user gesture
  (creating a new element per track is the classic reason audio silently fails on iOS);
- **Media Session** metadata and handlers, so the lock screen and Control Centre show the artwork
  and the play/pause/skip/scrub controls;
- `viewport-fit=cover` plus `env(safe-area-inset-*)` padding, so nothing hides under the notch or
  the home indicator;
- a service worker that caches the app shell and cover art but **never** audio, because partial
  (206) responses can't be cached safely and doing so breaks seeking;
- the queue and playback position are saved, so reopening the app resumes where you left off.

Because the collection is served over range requests, seeking anywhere in a two-hour FLAC costs one
request and no buffering of the whole file.

---

## How metadata scanning works

`backend/src/lib/scanner.ts`, in order:

1. **Walk** `MUSIC_ROOT` recursively. Hidden folders and junk (`@eaDir`, `.Trash`, `$RECYCLE.BIN`,
   macOS `._*` forks) are skipped. Files are kept when their extension is a known audio format
   (`mp3 flac m4a opus ogg wav aiff wv ape dsf …`); image files are remembered per folder as cover
   candidates.
2. **Reuse unchanged files.** If a file's path, size *and* mtime match the previous index, its
   record is copied as-is and no tags are re-read. This is what makes rescans cheap.
3. **Read tags** with `music-metadata` (`parseFile`, `duration: true`), a few files at a time
   (`SCAN_CONCURRENCY`). Recorded per track: title, artist, album artist, album, track/disc number,
   year, genres, duration, bitrate, sample rate, bit depth, channels, codec, container, lossless
   flag, file size and mtime.
4. **Fall back to the folder structure** whenever a tag is missing — metadata always wins, folders
   fill the gaps:
   - `Artist/Album/01 - Title.flac` → artist from the grandparent folder, album from the parent;
   - `Artist/1997 - OK Computer/…` and `Artist/OK Computer [1997]/…` → album name *and* year;
   - `Artist/Album/CD2/…` → folded into one album, with disc number 2;
   - the filename supplies the title (a leading track number is stripped) and the track number.
5. **Group** tracks into albums (keyed by album artist + album name, normalised for case, accents and
   punctuation), and albums into artists.
6. **Resolve cover art** per album: an image file in the album folder wins (`cover`, `folder`,
   `front`, `albumart`, `album`, `artwork`, in that order, any of jpg/jpeg/png/webp/gif/bmp);
   otherwise the first embedded picture found in the album's tracks. An artist uses an image in the
   artist folder if present, else the cover of their largest album.
7. **Persist** the index atomically to `$DATA_DIR/library-index.json` (written to a temp file, then
   renamed, so a crash mid-write can never corrupt it).

Cover images are extracted lazily on the first request for them, resized with `sharp` to the
requested size and cached in `$DATA_DIR/covers/`. A cached cover is reused until its source file's
mtime changes.

Ids are content-derived (`tr_…` from the relative path, `al_…`/`ar_…` from normalised names), so
favourites and shared links survive a rescan.

**Organising tips.** The scanner is happiest with `Artist/Year - Album/NN - Title.ext` and a
`cover.jpg` in each album folder — but well-tagged files in a flat folder work just as well, because
tags are always preferred.

---

## Environment variables

### Backend (`backend/.env`)

| Variable | Default | Description |
| --- | --- | --- |
| `MUSIC_ROOT` | `/home/admin/ssd/mediausb/music/` | Absolute path to the collection. **Required.** |
| `HOST` | `0.0.0.0` | Listen address. |
| `PORT` | `1981` | Listen port. |
| `DATA_DIR` | `./data` | Where the JSON index and cover cache are written. |
| `CORS_ORIGINS` | `*` | Comma-separated allowed browser origins. |
| `SCAN_ON_START` | `true` | Scan when the process starts (incremental if a cache exists). |
| `SCAN_INTERVAL_MINUTES` | `360` | Background rescan interval; `0` disables. |
| `SCAN_CONCURRENCY` | CPU count (2–8) | Files parsed in parallel. |
| `ADMIN_TOKEN` | *(empty)* | Bearer token for `POST /api/rescan`. Empty disables the route. |
| `COVER_SIZES` | `128,320,640` | Thumbnail sizes generated on demand. |
| `FOLLOW_SYMLINKS` | `false` | Follow symlinks while walking (loop-guarded). |
| `AUTH_ENABLED` | `true` | Require an account to browse and an invite to register. |
| `DATABASE_URL` | `postgres://boozie:boozie@localhost:5432/boozie_archive` | PostgreSQL connection string. |
| `DATABASE_SSL` | `false` | TLS for a managed Postgres. |
| `SESSION_TTL_DAYS` | `30` | How long a signed-in browser stays signed in. |
| `COOKIE_SAMESITE` | `lax` | `none` when the frontend is on another origin. |
| `COOKIE_SECURE` | `false` | `true` for HTTPS / cross-origin. |
| `MIN_PASSWORD_LENGTH` | `8` | Minimum password length at registration. |
| `LOGIN_MAX_ATTEMPTS` | `10` | Failed sign-ins per username+IP before lockout. |
| `LOGIN_WINDOW_MINUTES` | `15` | Length of that lockout window. |
| `ALLOW_PUBLIC_BROWSE` | `false` | Let signed-out visitors browse (joining still needs an invite). |
| `TRUST_PROXY` | `loopback` | Which proxies may set `X-Forwarded-For`. `loopback`, `false`, or a CIDR list. |
| `MESSAGE_RATE_PER_MINUTE` | `30` | Messages one account may send per minute. |
| `MESSAGE_MAX_LENGTH` | `2000` | Maximum characters in a message. |
| `FRIEND_REQUESTS_PER_HOUR` | `30` | Friend requests one account may send per hour. |
| `GIPHY_API_KEY` | *(empty)* | Enables the Giphy tab in the picker. |
| `TENOR_API_KEY` | *(empty)* | Enables the Tenor tab. |
| `EMOJI_GG_ENABLED` | `true` | Enables the emoji.gg tab (no key needed). |
| `SERVE_FRONTEND` | `true` | Also serve `frontend/dist` at `/` when it exists. |
| `FRONTEND_DIST` | `../frontend/dist` | Where the built web app lives (relative to the working directory). |
| `LOG_LEVEL` | `info` | `fatal`…`trace`. |

### Frontend (`frontend/.env`, build time)

| Variable | Default | Description |
| --- | --- | --- |
| `VITE_API_BASE_URL` | *(empty → same origin)* | Leave **empty** when the Pi serves the app (Option A). Set it only for a separate static host, e.g. `https://music-api.example.com`. |
| `VITE_SITE_NAME` | `BOOZIE ARCHIVE` | Wordmark in the header and hero. |
| `VITE_SITE_TAGLINE` | `A personal, lossless-first music vault.` | Line under the hero heading. |

---

## API reference

All JSON endpoints are `GET` unless noted, and all list endpoints accept
`?q=&genre=&year=&sort=&limit=&offset=` (`sort` ∈ `name | recent | tracks | year | duration | random`).
List responses are `{ items, total, limit, offset }`.

Everything except `/api/health` and the `/api/auth/*` endpoints requires a
session cookie when `AUTH_ENABLED=true`.

| Endpoint | Description |
| --- | --- |
| `/api/auth/context` | Whether accounts are on, and whether this is a fresh install. |
| `/api/auth/me` | The signed-in account, or `null`. |
| `POST /api/auth/register` | Create an account (`username`, `password`, `inviteCode`). |
| `POST /api/auth/login` | Sign in; sets the session cookie. |
| `POST /api/auth/logout` | Destroy the session. |
| `/api/auth/invite/:code` | Pre-check a code before submitting the form. |
| `POST /api/auth/password` | Change your password; signs out other devices. |
| `/api/admin/invites` | **Admin.** List codes. `POST` creates one, `PATCH :id` enables/disables, `DELETE :id` removes. |
| `/api/admin/users` | **Admin.** List accounts. `PATCH :id` sets role/disabled, `DELETE :id` removes. |
| `/api/profile/me` | Your profile. `PATCH` updates name, bio, avatar and accent. |
| `/api/profile/:username` | Someone else's profile, plus your relationship to them. |
| `/api/users/search?q=` | Member directory search. |
| `/api/friends` | Friends plus incoming and outgoing requests. |
| `POST /api/friends/requests` | Send a request. `POST /api/friends/requests/:id/accept` accepts. |
| `DELETE /api/friends/:userId` | Decline, cancel or unfriend. `/block` blocks and unblocks. |
| `/api/dm/threads` | Your conversations. `POST` opens one with a friend. |
| `/api/dm/threads/:id/messages` | Read a thread; `POST` sends. `POST :id/read` clears the badge. |
| `DELETE /api/dm/messages/:id` | Soft-delete your own message. |
| `/api/social/badges` | Unread message and pending request counts. |
| `/api/stickers/gifs?q=&provider=` | Proxied Giphy/Tenor search. `/stickers/emojis` for emoji.gg. |
| `/api/health` | Liveness, whether the library is indexed and whether a scan is running. |
| `/api/stats` | Counts, total size, total runtime, format breakdown, last scan time. |
| `/api/scan/status` | Live scan progress (files found / parsed / reused / errors). |
| `POST /api/rescan` | Triggers a rescan. Requires `Authorization: Bearer $ADMIN_TOKEN`. `?covers=clear` also empties the cover cache. |
| `/api/artists` | Paginated artist list. |
| `/api/artists/:id` | `{ artist, albums }`. |
| `/api/artists/:id/tracks` | Paginated tracks for one artist. |
| `/api/albums` | Paginated album list (`?artistId=` to scope). |
| `/api/albums/:id` | `{ album, artist, tracks }`, tracks in disc/track order. |
| `/api/tracks` | Paginated flat track list (`?albumId=`, `?artistId=`). |
| `/api/tracks/:id` | `{ track, album, artist }`. |
| `/api/search?q=` | Combined artists + albums + tracks, for type-ahead. |
| `/api/genres`, `/api/years` | Facet values with counts. |
| `/api/recent?limit=` | Most recently added albums. |
| `/api/library?tracks=1` | Whole-library snapshot (large; tracks only when asked). |
| `/api/stream/:id` | Audio with `Accept-Ranges: bytes`, `206 Partial Content`, correct `Content-Type`. |
| `/api/download/:id` | Same bytes as `attachment`, with a readable filename. |
| `/api/cover/:id?size=` | Cover art for an album, artist **or** track id. `size` snaps to `COVER_SIZES`. |

Every filesystem read is checked against `MUSIC_ROOT` before it happens, so no request can escape the
collection directory.

Anything outside `/api/*` is the web app: known files come from `frontend/dist`, and every other GET
falls back to `index.html` so client-side routes work on a hard refresh. Unknown `/api/*` paths keep
returning JSON 404s.

---

## Project structure

```
boozie-archive/
├── backend/
│   ├── src/
│   │   ├── index.ts              # Fastify bootstrap, CORS, compression, scan scheduling
│   │   ├── config.ts             # env parsing, format/MIME tables
│   │   ├── types.ts              # shared data model
│   │   ├── cli/scan.ts           # one-shot scanner (npm run scan)
│   │   ├── db/
│   │   │   ├── pool.ts           # pg pool + migration runner
│   │   │   └── schema.ts         # SQL migrations (accounts, invites, sessions)
│   │   ├── lib/
│   │   │   ├── auth.ts           # accounts, sessions, invite redemption
│   │   │   ├── social.ts         # friends, direct messages, profiles
│   │   │   ├── passwords.ts      # scrypt hashing, session tokens, code generation
│   │   │   ├── scanner.ts        # walk + tag reading + folder fallbacks + aggregation
│   │   │   ├── library.ts        # in-memory index, queries, persistence
│   │   │   ├── covers.ts         # artwork extraction, resizing, disk cache
│   │   │   ├── paths.ts          # path traversal guard, Content-Disposition
│   │   │   ├── ids.ts            # stable content-derived ids
│   │   │   └── text.ts           # tag/filename normalisation helpers
│   │   └── routes/
│   │       ├── auth.ts           # register / login / logout / invite pre-check
│   │       ├── admin.ts          # invite + account management (admins only)
│   │       ├── social.ts         # friends, DMs, profiles
│   │       ├── stickers.ts       # proxied Giphy / Tenor / emoji.gg search
│   │       ├── api.ts            # JSON metadata endpoints
│   │       └── media.ts          # streaming (range), downloads, covers
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/           # Layout, Player, SearchBar, cards, track rows, states
│   │   ├── context/              # AuthContext, PlayerContext (audio + Media Session), FavoritesContext
│   │   ├── hooks/                # react-query wrappers, URL-synced filters, debounce
│   │   ├── lib/                  # API client, formatters, runtime config
│   │   └── pages/                # Home, Artists, Album, Tracks, Search, Auth, Admin, …
│   ├── public/                   # manifest, icons, service worker, host redirects
│   └── .env.example
├── POSTGRES.md                   # database setup guide for the Pi
├── SECURITY.md                   # threat model, audit findings, what is not covered
├── scripts/doctor.mjs            # `npm run doctor` — diagnoses a broken setup
├── deploy/boozie-archive.service # systemd unit
├── ecosystem.config.cjs          # pm2 process definition (port 1981)
└── README.md
```

---

## Troubleshooting

**Anything at all — start here.**

```bash
cd ~/boozie-archive && npm run doctor
```

It checks the Node version, both builds, the baked-in API URL, `MUSIC_ROOT`, the data directory and
what the running server is actually serving on its port, then prints the command that fixes whatever
is wrong.

**I open the Pi's address and get JSON (`{"name":"boozie-archive-api"…}`) instead of the app.**
The frontend build is missing. `npm run setup` in the repo root, then `pm2 restart
boozie-archive-api`. The JSON's `checked` array lists the directories the running server looked in;
if your build lives somewhere else, set `FRONTEND_DIST` in `backend/.env`. On startup the server logs
either `Serving the web app from …` or a loud error naming the same directories.

**`npm --prefix frontend install` or the Vite build fails on the Pi.**
Usually npm's optional-dependency bug on arm64 — the error mentions
`@rollup/rollup-linux-arm64-gnu`. Clear and reinstall:

```bash
rm -rf frontend/node_modules frontend/package-lock.json
npm --prefix frontend install
```

If the build is killed for memory on a 2 GB Pi, give Node more headroom:
`NODE_OPTIONS=--max-old-space-size=1536 npm --prefix frontend run build`.

**The frontend shows “Could not reach the archive server”.**
Check `curl https://<your-api-url>/api/health` from your phone's network. If that works but the app
doesn't, it's CORS: set `CORS_ORIGINS` to include the frontend origin (or `*`) and restart.

**Playback works on desktop but not on iPhone.**
Confirm the API is served over **HTTPS** — Safari refuses mixed content from an HTTPS page. Check
that range requests return `206`:
`curl -H 'Range: bytes=0-1' -D - -o /dev/null https://<api>/api/stream/<id>`.

**Seeking jumps back to the start.**
Something in front of the backend is stripping range support. Cloudflare Tunnel and Tailscale Funnel
both pass ranges through; a reverse proxy with buffering enabled (some nginx configs) may not.

**Covers are missing.**
Only some files have embedded art. Drop a `cover.jpg` into the album folder — it takes priority over
embedded art on the next rescan. If *all* covers are missing, check that `DATA_DIR` is writable.

**`sharp` failed to install.**
It's optional: `npm install --omit=optional` and the server serves original images instead of
thumbnails. Everything else works.

**The scan finds nothing.**
Check the path and permissions: `sudo -u admin ls /home/admin/ssd/mediausb/music/`. The server logs
`MUSIC_ROOT "…" is not readable` at startup when it can't stat the directory.

**Rescan returns 404.**
`ADMIN_TOKEN` is empty, which disables the route by design. Set one and restart.

**The app loads but every request fails, and it's hosted on the Pi.**
`VITE_API_BASE_URL` was set at build time and points somewhere unreachable (often `localhost:1981`,
which means *the phone* when opened on a phone). Clear it, rebuild the frontend, restart. Or override
it at runtime in **Settings**.

**The server exits with `Cannot reach PostgreSQL …`.**
Deliberate: booting without the database would serve the whole archive with no
accounts and no invite checks. Fix `DATABASE_URL` in `backend/.env` (see
[POSTGRES.md](POSTGRES.md)), or set `AUTH_ENABLED=false` to run without accounts.

**I'm locked out of the admin panel.**
`npm --prefix backend run admin -- yourname 'a-new-password'` creates or promotes
an admin and resets its password.

**Signing in works, then every request says "Sign in to browse".**
The session cookie isn't coming back. Almost always a cross-origin frontend: set
`COOKIE_SAMESITE=none`, `COOKIE_SECURE=true`, serve the API over HTTPS, and put
the exact frontend origin in `CORS_ORIGINS` — `*` is not allowed with cookies.

**Signing out doesn't sign me out (Safari).**
Fixed. The logout request was being rejected with a 400 and the client hid the
failure, so the session stayed alive on the server. Pull, rebuild, and restart.

**The GIF tab says search isn't configured.**
No `GIPHY_API_KEY` / `TENOR_API_KEY` in `backend/.env`. A Giphy key is free from
their developer dashboard; restart after adding it. emoji.gg needs no key.

**The app looks stale after a deploy.**
The service worker caches the app shell. **Settings → Clear offline cache & reload**, or on iOS
remove and re-add the home-screen icon.

---

## Licence

Private project. The music it serves is yours; keep sharing within what your rights allow.
