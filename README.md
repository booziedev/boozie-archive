# Boozie Archive

A personal music archiv

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
- **Profiles** with uploadable picture/GIF avatars, a display name, bio and accent
- **Listening now** — friends see what you have playing, updated as you skip and
  marked as paused when you pause it, with per-account visibility in Settings
- **Listen together** — invite a friend from a chat and your players stay in step;
  the host's skips, pauses and seeks follow through to everyone listening along
- **Themeable UI** — hue slider or hex accent, plus animated gradient backgrounds
- **Maintenance mode**, a **global announcement**, and a **suggestions** queue where
  members propose features or upload tracks for an admin to approve
- Installable from **Safari on iOS** as a full-screen app with lock-screen controls

## Branding

The mark in the sidebar, on the sign-in screen and on the maintenance page comes
from one file:

```bash
# 1. save your artwork as a square PNG (512px or larger, transparent if you have it)
cp ~/my-logo.png frontend/public/icons/logo.png

# 2. generate the favicon, apple-touch and PWA sizes from it
npm run icons

# 3. rebuild and restart
npm --prefix frontend run build && pm2 restart boozie-archive-api
```

Until `logo.png` exists the app falls back to a built-in disc glyph, so nothing
is ever broken. `npm run icons -- path/to/art.png` reads from somewhere else if
you'd rather not copy the file in first.

## Guides

- [POSTGRES.md](POSTGRES.md) — database setup on the Pi, backups, troubleshooting
- [SECURITY.md](SECURITY.md) — threat model, audit findings, and what is not covered
- `npm run doctor` — checks the whole setup and prints the fix for anything broken

## Licence

Private project. The music it serves is yours; keep sharing within what your rights allow.
