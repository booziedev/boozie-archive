# Security model

What this archive assumes, what it protects, and what it deliberately does not.

The threat model is a small private community: everyone with an account was
invited by an admin, the server sits behind a Tailscale Funnel or Cloudflare
Tunnel, and the collection is personal. The goal is that a hostile *visitor* — a
stranger with a link, or a website a signed-in member happens to open — cannot
read the library, other people's messages, or act on their behalf.

---

## Findings from the audit, and what changed

These were real holes in the first accounts release, found by testing rather
than reading:

| Issue | Impact | Fix |
| --- | --- | --- |
| CORS reflected any `Origin` with `credentials: true` | **Critical.** Any website a signed-in member opened could read their whole archive, DMs and admin data with their cookie | Credentials are granted only to origins explicitly listed in `CORS_ORIGINS`; a wildcard now means same-origin only |
| `trustProxy: true` | Anyone could forge `X-Forwarded-For` and walk past the login throttle | Only the loopback proxy is trusted (`TRUST_PROXY`) |
| No cache directives on API replies | Safari served `/api/auth/me` from its own cache after signing out, so the app looked signed in | `Cache-Control: no-store` + `Vary: Origin, Cookie` on every non-media API response |
| Logout sent `Content-Type: application/json` with an empty body | Fastify answered **400**, the session was never destroyed, and the client hid the failure — the user stayed signed in | The client only declares a JSON body when it sends one, and sign-out no longer swallows errors |
| No CSRF defence | A third-party page could POST with the member's cookie (SameSite=Lax limited this, but `COOKIE_SAMESITE=none` removed the limit) | Cookie-authenticated writes require a matching `Origin` or an explicit `X-Requested-With` header |
| Admin guard matched on the raw URL | A query string or odd path could confuse the prefix check | Matched on the parsed pathname, and a signed-out request is rejected before the role check |
| `SELECT u.*` for the admin user list | Pulled every password hash into memory for a page that shows names | Columns listed explicitly |
| Unlimited invite-code checking | Codes could be ground through offline-style | Per-IP throttle on registration and code pre-checks |

---

## How accounts are protected

**Passwords** are hashed with scrypt (N=16384, r=8, p=1, 64-byte key, random
16-byte salt per password) using Node's built-in crypto — no native module to
compile on a Pi. Verification is constant-time. An unknown username costs the
same time as a wrong password, so responses don't reveal who has an account.

**Sessions** are 32 bytes of `crypto.randomBytes`, sent in an httpOnly cookie
and stored only as SHA-256. A database dump cannot be replayed as a login. They
expire after `SESSION_TTL_DAYS` (30 by default), are deleted server-side on
sign-out, and are revoked in bulk when a password changes or an account is
disabled — a disabled member is logged out everywhere on their next request,
not at their next login.

Cookies are used rather than a bearer token in `localStorage` because `<audio>`
and `<img>` cannot send an `Authorization` header, and the player needs
credentials to stream. That choice is what makes the CSRF rule necessary.

**Invites** are consumed inside the registration transaction with the row
locked, so two people racing for the last use of a code cannot both get in, and
a failed registration rolls the use back. Codes can be disabled and re-enabled
without touching the accounts that already used them.

**Admins**: the last active admin cannot be demoted, disabled or deleted, and no
admin can demote or delete themselves.

---

## How messages are protected

- **Messaging is friends-only.** Both people must have accepted; losing the
  friendship closes the conversation immediately, in both directions.
- **Every thread read re-checks membership.** A non-member gets `404`, the same
  answer as a thread that doesn't exist, so ids cannot be probed.
- **A thread is keyed by the pair of people**, stored in a canonical order, so
  there is exactly one conversation per pair regardless of who opened it.
- **Rate limits**: `MESSAGE_RATE_PER_MINUTE` (30) messages a minute,
  `FRIEND_REQUESTS_PER_HOUR` (30) requests an hour, `MESSAGE_MAX_LENGTH` (2000)
  characters.
- Deleting a message is a soft delete by the sender only; the row survives so
  ordering stays stable, and the content is dropped from every response.

## How embedded media is protected

Anything that ends up as a remote `<img>` — GIF and emoji attachments, and
avatars — is checked at write time against a host allowlist
(`ALLOWED_MEDIA_HOSTS`: Giphy, Tenor and emoji.gg CDNs, https only). This stops
two things: leaking viewers' IP addresses to arbitrary hosts, and pointing an
avatar at an internal address to probe the network from other members' browsers.
An avatar set to `http://169.254.169.254/…` is rejected, not fetched.

GIF and emoji **searches are proxied through the Pi**. The API keys stay on the
server, and Giphy/Tenor/emoji.gg never see a member's IP or what they searched
for. Remote images are requested with `referrerPolicy="no-referrer"`.

## Everything else

- **Path traversal**: every filesystem read resolves the path and verifies it is
  still inside `MUSIC_ROOT` before opening it, even though paths come from the
  index rather than the request.
- **SQL injection**: every query is parameterised; no string interpolation of
  user input anywhere.
- **Response headers**: `X-Content-Type-Options: nosniff`, `X-Frame-Options:
  DENY` (no clickjacking), `Referrer-Policy: strict-origin-when-cross-origin`.
- **Body limit**: 256 KB — a metadata API needs kilobytes.
- **Errors**: unexpected failures return a generic message; stack traces and
  driver errors stay in the log.
- **Fail closed**: if PostgreSQL is unreachable the server exits rather than
  serving the archive with no accounts and no invite checks.

---

## What is *not* protected

Be clear-eyed about these:

- **Members can enumerate other members.** User search returns every enabled
  account. That is deliberate — you need it to add a friend — and matches how
  Discord works, but it means an invited member learns who else is in the
  archive.
- **Members can download everything.** Anyone signed in can stream and download
  the whole collection. Invites are the only gate; hand them out accordingly.
- **No end-to-end encryption.** Direct messages are stored in plain text in
  PostgreSQL. An admin with database access can read them. They are private
  between members, not private from the server operator.
- **No email, so no password reset.** A forgotten password needs
  `npm --prefix backend run admin -- <user> <newpassword>` on the Pi.
- **No 2FA.**
- **Media is served without per-request authorisation beyond the session.** A
  signed-in member who copies a `/api/stream/:id` URL can share it with someone
  who is *also* signed in; the URL is not a capability token, it still requires
  a session.

## If you host the frontend on another origin

The defaults assume the Pi serves both the app and the API. To split them:

```ini
CORS_ORIGINS=https://your-frontend.pages.dev   # exact origin, never *
COOKIE_SAMESITE=none
COOKIE_SECURE=true                             # requires HTTPS
```

A wildcard cannot carry credentials, and the server will not pretend otherwise.

## Reporting

It's a personal project — if you find something, open an issue on the
repository.
