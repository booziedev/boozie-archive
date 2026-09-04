# PostgreSQL on the Raspberry Pi

Accounts, invite codes and sessions live in PostgreSQL on the same Pi that
serves the music. This is the whole setup, start to finish — about five minutes.

> Only needed once. If you'd rather run the archive with no accounts at all, set
> `AUTH_ENABLED=false` in `backend/.env` and skip this page entirely.

---

## 1. Install the server

```bash
sudo apt update
sudo apt install -y postgresql
```

Raspberry Pi OS (Bookworm) installs PostgreSQL 15, Trixie installs 17 — either
is fine, the schema needs 13 or newer. Check it started:

```bash
sudo systemctl status postgresql --no-pager
psql --version
```

The service is enabled on boot by default. If it isn't:

```bash
sudo systemctl enable --now postgresql
```

---

## 2. Create the database and its user

`postgres` is the database superuser; `sudo -u postgres` runs commands as it.

**Generate a password first** and keep it somewhere — you'll paste it twice:

```bash
openssl rand -base64 24
```

Then create the role and database, substituting your password:

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE boozie WITH LOGIN PASSWORD 'PASTE_YOUR_PASSWORD_HERE';
CREATE DATABASE boozie_archive OWNER boozie;
SQL
```

Confirm you can connect as that user over TCP (which is how the app connects):

```bash
psql "postgres://boozie:PASTE_YOUR_PASSWORD_HERE@127.0.0.1:5432/boozie_archive" -c '\conninfo'
```

You should see `You are connected to database "boozie_archive" as user "boozie"`.

<details>
<summary>If that fails with "Peer authentication failed"</summary>

Peer auth only applies to Unix-socket connections. Make sure you used the
`postgres://…@127.0.0.1:5432/…` URL above rather than a bare `psql boozie_archive`.
If TCP connections are refused entirely, check that
`/etc/postgresql/*/main/pg_hba.conf` contains a line like:

```
host    all             all             127.0.0.1/32            scram-sha-256
```

then `sudo systemctl restart postgresql`.
</details>

---

## 3. Point the app at it

Edit `backend/.env`:

```ini
AUTH_ENABLED=true
DATABASE_URL=postgres://boozie:PASTE_YOUR_PASSWORD_HERE@127.0.0.1:5432/boozie_archive
```

If your password contains `@`, `/`, `:` or `#`, percent-encode it in the URL
(`@` → `%40`, `/` → `%2F`, `:` → `%3A`, `#` → `%23`), or just generate one
without those characters.

Restart the backend:

```bash
pm2 restart boozie-archive-api      # or: sudo systemctl restart boozie-archive
pm2 logs boozie-archive-api --lines 30
```

On first start you'll see the tables being created:

```
Applying migration 001_auth
Accounts enabled — registration requires an invite code.
```

The app creates and migrates its own tables — there is no schema to import.

Check it end to end:

```bash
npm run doctor
curl -s localhost:1981/api/auth/context
# {"authEnabled":true,"needsSetup":true,...}
```

`needsSetup: true` means the database is connected and empty, which is exactly
where you want to be.

---

## 4. Create your admin account

Open `http://<pi-address>:1981/` in a browser. Because no accounts exist yet,
the first screen offers **Set up the archive**: pick a username and password and
that account becomes the admin — no invite code needed. Everyone after that
needs one.

Prefer the command line, or locked yourself out?

```bash
cd ~/boozie-archive
npm --prefix backend run admin -- yourname 'your-password'
```

That creates the account if it's new, or promotes an existing one to admin and
resets its password.

---

## 5. Hand out invites

Sign in, open **Admin** in the sidebar, and generate a code:

- **Expire after** — 30 minutes to 30 days, or never
- **Max number of uses** — 1 to 100, or unlimited
- **Label** — a note to yourself, e.g. "discord friends"

Each row shows a live countdown, how many uses are left, and a status of
`active`, `disabled`, `expired` or `exhausted`. The toggle disables a code
without deleting it — the accounts that already used it keep working — and you
can re-enable it at any time. The link button copies
`https://your-archive/invite/CODE`, which opens the sign-up form with the code
already filled in.

---

## Backups

Everything here is small (a few kilobytes per account), so a nightly dump costs
nothing:

```bash
mkdir -p ~/backups
pg_dump "postgres://boozie:PASSWORD@127.0.0.1:5432/boozie_archive" \
  | gzip > ~/backups/boozie-$(date +%F).sql.gz
```

As a cron job, keeping 14 days:

```bash
crontab -e
```

```cron
30 4 * * * pg_dump "postgres://boozie:PASSWORD@127.0.0.1:5432/boozie_archive" | gzip > ~/backups/boozie-$(date +\%F).sql.gz && find ~/backups -name 'boozie-*.sql.gz' -mtime +14 -delete
```

Restore into an empty database with:

```bash
gunzip -c ~/backups/boozie-2026-01-31.sql.gz | psql "postgres://boozie:PASSWORD@127.0.0.1:5432/boozie_archive"
```

The music itself is never in the database — only accounts, invites and sessions.
Losing this database costs you the user list, not the collection.

---

## What's stored

| Table | Contents |
| --- | --- |
| `users` | username, password hash, role, disabled flag, timestamps, which invite they used |
| `invites` | code, label, expiry, max uses, use count, disabled flag, creator |
| `invite_redemptions` | which account used which code, and when |
| `sessions` | SHA-256 of each session token, expiry, last-seen, user agent |
| `schema_migrations` | which migrations have run |

Passwords are hashed with **scrypt** (16384/8/1, per-password random salt) using
Node's built-in crypto — no plaintext, and no native module to compile on the
Pi. Session cookies are stored only as SHA-256 hashes: a stolen database dump
cannot be replayed as a live login. Disabling an account deletes its sessions
immediately, so it takes effect on the next request rather than at next login.

---

## Troubleshooting

**`Cannot reach PostgreSQL …` and the server exits.**
This is deliberate — starting without the database would serve the entire
archive with no accounts and no invite checks. Fix `DATABASE_URL`, or set
`AUTH_ENABLED=false` to run without accounts. The full error is in the log:
`pm2 logs boozie-archive-api`.

**`password authentication failed for user "boozie"`.**
The password in `DATABASE_URL` doesn't match. Reset it:

```bash
sudo -u postgres psql -c "ALTER ROLE boozie WITH PASSWORD 'new-password';"
```

**`database "boozie_archive" does not exist`.**
Step 2 didn't complete. Re-run the `CREATE DATABASE` line.

**`permission denied for schema public`.**
On PostgreSQL 15+ a non-owner can't create tables. Make sure the database is
owned by `boozie`:

```bash
sudo -u postgres psql -c "ALTER DATABASE boozie_archive OWNER TO boozie;"
sudo -u postgres psql -d boozie_archive -c "GRANT ALL ON SCHEMA public TO boozie;"
```

**I'm locked out of the admin panel.**
Promote any account from the command line:

```bash
npm --prefix backend run admin -- yourname 'a-new-password'
```

**Start over completely.**

```bash
sudo -u postgres psql -c "DROP DATABASE boozie_archive;"
sudo -u postgres psql -c "CREATE DATABASE boozie_archive OWNER boozie;"
pm2 restart boozie-archive-api
```

The next visit will offer the first-account setup screen again.
