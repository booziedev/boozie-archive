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
- **Themeable UI** — hue slider or hex accent, plus animated gradient backgrounds
- Installable from **Safari on iOS** as a full-screen app with lock-screen controls

## Guides

- [POSTGRES.md](POSTGRES.md) — database setup on the Pi, backups, troubleshooting
- [SECURITY.md](SECURITY.md) — threat model, audit findings, and what is not covered
- `npm run doctor` — checks the whole setup and prints the fix for anything broken

## Licence

Private project. The music it serves is yours; keep sharing within what your rights allow.
