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
- Installable from **Safari on iOS** as a full-screen app with lock-screen controls

---

## Table of contents

1. [Architecture](#architecture)
2. [Quick start (local)](#quick-start-local)
3. [Backend on the Raspberry Pi](#backend-on-the-raspberry-pi)
4. [Running it as a service](#running-it-as-a-service)
5. [Exposing it publicly for free](#exposing-it-publicly-for-free)
6. [Deploying the frontend for free](#deploying-the-frontend-for-free)
7. [Installing on iOS](#installing-on-ios)
8. [How metadata scanning works](#how-metadata-scanning-works)
9. [Environment variables](#environment-variables)
10. [API reference](#api-reference)
11. [Project structure](#project-structure)
12. [Troubleshooting](#troubleshooting)

---

## Architecture

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
#   edit backend/.env and point MUSIC_ROOT at a folder with music in it
npm run dev:backend          # http://localhost:1981

# --- frontend (second terminal) ---
cp frontend/.env.example frontend/.env
npm run dev:frontend         # http://localhost:5173
```

The dev server proxies `/api` to `http://localhost:1981`, so `VITE_API_BASE_URL` can be left empty
while developing locally.

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
cd boozie-archive/backend
npm install                  # installs sharp too, for cover thumbnails
npm run build                # compiles TypeScript to dist/
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

## Deploying the frontend for free

The build output is plain static files. Set `VITE_API_BASE_URL` to your public API URL **at build
time**, and configure the SPA fallback so deep links like `/albums/al_xxx` don't 404 (the included
`public/_redirects`, `vercel.json` and `netlify.toml` already do this).

### Cloudflare Pages

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

### Vercel

Import the repo, set **Root Directory** to `frontend`, add the same environment variables. The
included `vercel.json` handles the build and the SPA rewrites.

### Netlify

Import the repo; `frontend/netlify.toml` sets the build command, publish directory and SPA redirect.
Add `VITE_API_BASE_URL` under **Site settings → Environment variables**.

### Manual / self-hosted

```bash
cd frontend
VITE_API_BASE_URL=https://music-api.example.com npm run build
# copy dist/ anywhere that serves static files with an index.html fallback
```

> Changing the API URL later doesn't require a redeploy: the **Settings** page in the app lets you
> override it at runtime (stored in `localStorage`), which is handy while a quick tunnel keeps
> handing out new hostnames.

---

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
| `LOG_LEVEL` | `info` | `fatal`…`trace`. |

### Frontend (`frontend/.env`, build time)

| Variable | Default | Description |
| --- | --- | --- |
| `VITE_API_BASE_URL` | *(empty → same origin)* | Base URL of the backend, e.g. `https://music-api.example.com`. |
| `VITE_SITE_NAME` | `BOOZIE ARCHIVE` | Wordmark in the header and hero. |
| `VITE_SITE_TAGLINE` | `A personal, lossless-first music vault.` | Line under the hero heading. |

---

## API reference

All JSON endpoints are `GET` unless noted, and all list endpoints accept
`?q=&genre=&year=&sort=&limit=&offset=` (`sort` ∈ `name | recent | tracks | year | duration | random`).
List responses are `{ items, total, limit, offset }`.

| Endpoint | Description |
| --- | --- |
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
│   │   ├── lib/
│   │   │   ├── scanner.ts        # walk + tag reading + folder fallbacks + aggregation
│   │   │   ├── library.ts        # in-memory index, queries, persistence
│   │   │   ├── covers.ts         # artwork extraction, resizing, disk cache
│   │   │   ├── paths.ts          # path traversal guard, Content-Disposition
│   │   │   ├── ids.ts            # stable content-derived ids
│   │   │   └── text.ts           # tag/filename normalisation helpers
│   │   └── routes/
│   │       ├── api.ts            # JSON metadata endpoints
│   │       └── media.ts          # streaming (range), downloads, covers
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/           # Layout, Player, SearchBar, cards, track rows, states
│   │   ├── context/              # PlayerContext (audio + Media Session), FavoritesContext
│   │   ├── hooks/                # react-query wrappers, URL-synced filters, debounce
│   │   ├── lib/                  # API client, formatters, runtime config
│   │   └── pages/                # Home, Artists, Artist, Albums, Album, Tracks, Search, …
│   ├── public/                   # manifest, icons, service worker, host redirects
│   └── .env.example
├── deploy/boozie-archive.service # systemd unit
├── ecosystem.config.cjs          # pm2 process definition (port 1981)
└── README.md
```

---

## Troubleshooting

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

**The app looks stale after a deploy.**
The service worker caches the app shell. **Settings → Clear offline cache & reload**, or on iOS
remove and re-add the home-screen icon.

---

## Licence

Private project. The music it serves is yours; keep sharing within what your rights allow.
