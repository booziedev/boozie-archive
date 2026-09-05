/**
 * Database migrations.
 *
 * Migrations are plain SQL kept in TypeScript so they are part of the compiled
 * output — no file copying step, and `dist/` is self-contained. Each entry runs
 * once, inside a transaction, and is recorded in `schema_migrations`.
 *
 * Never edit a migration that has shipped; add a new one.
 */
export interface Migration {
  id: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    id: '001_auth',
    sql: /* sql */ `
      -- gen_random_uuid() is built in from PostgreSQL 13; the extension keeps
      -- this working on older servers too.
      CREATE EXTENSION IF NOT EXISTS pgcrypto;

      CREATE TABLE IF NOT EXISTS invites (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code         text NOT NULL UNIQUE,
        label        text,
        created_by   uuid,
        created_at   timestamptz NOT NULL DEFAULT now(),
        -- NULL means "never expires" / "unlimited uses", as in Discord.
        expires_at   timestamptz,
        max_uses     integer CHECK (max_uses IS NULL OR max_uses > 0),
        uses         integer NOT NULL DEFAULT 0,
        disabled     boolean NOT NULL DEFAULT false
      );

      CREATE TABLE IF NOT EXISTS users (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        username       text NOT NULL,
        password_hash  text NOT NULL,
        role           text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
        disabled       boolean NOT NULL DEFAULT false,
        created_at     timestamptz NOT NULL DEFAULT now(),
        last_login_at  timestamptz,
        invite_id      uuid REFERENCES invites(id) ON DELETE SET NULL
      );

      -- Usernames are compared case-insensitively: "Boozie" and "boozie" are
      -- the same account, and only one of them can exist.
      CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_key
        ON users (lower(username));

      ALTER TABLE invites
        DROP CONSTRAINT IF EXISTS invites_created_by_fkey;
      ALTER TABLE invites
        ADD CONSTRAINT invites_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

      CREATE TABLE IF NOT EXISTS invite_redemptions (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        invite_id  uuid NOT NULL REFERENCES invites(id) ON DELETE CASCADE,
        user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        ip         text
      );

      CREATE INDEX IF NOT EXISTS invite_redemptions_invite_idx
        ON invite_redemptions (invite_id);

      CREATE TABLE IF NOT EXISTS sessions (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        -- Only the SHA-256 of the token is stored: a database dump can never be
        -- replayed as a live session.
        token_hash   text NOT NULL UNIQUE,
        created_at   timestamptz NOT NULL DEFAULT now(),
        expires_at   timestamptz NOT NULL,
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        user_agent   text,
        ip           text
      );

      CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
      CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);
    `,
  },
  {
    id: '002_social',
    sql: /* sql */ `
      -- Profile customisation. Avatars are URLs on an allowlisted host (the
      -- same providers the GIF picker searches), so animated avatars work
      -- without this server storing or proxying user uploads.
      ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name text;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS bio text;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url text;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS accent_color text;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_updated_at timestamptz;

      CREATE TABLE IF NOT EXISTS friendships (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        requester_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        addressee_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status        text NOT NULL CHECK (status IN ('pending', 'accepted', 'blocked')),
        -- Who pressed block; NULL unless status = 'blocked'.
        blocked_by    uuid REFERENCES users(id) ON DELETE CASCADE,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT friendships_not_self CHECK (requester_id <> addressee_id)
      );

      -- One row per pair of people, whichever direction the request went.
      CREATE UNIQUE INDEX IF NOT EXISTS friendships_pair_key
        ON friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
      CREATE INDEX IF NOT EXISTS friendships_addressee_idx ON friendships (addressee_id, status);
      CREATE INDEX IF NOT EXISTS friendships_requester_idx ON friendships (requester_id, status);

      -- Direct message threads. user_a < user_b keeps one canonical row per
      -- pair, so looking a thread up never depends on who opened it.
      CREATE TABLE IF NOT EXISTS dm_threads (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_a          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_b          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at      timestamptz NOT NULL DEFAULT now(),
        last_message_at timestamptz,
        CONSTRAINT dm_threads_ordered CHECK (user_a < user_b)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS dm_threads_pair_key ON dm_threads (user_a, user_b);

      CREATE TABLE IF NOT EXISTS dm_messages (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        thread_id  uuid NOT NULL REFERENCES dm_threads(id) ON DELETE CASCADE,
        sender_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body       text,
        -- A shared album/artist/track, or a GIF/emoji from the picker.
        attachment jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT dm_messages_not_empty CHECK (body IS NOT NULL OR attachment IS NOT NULL)
      );

      CREATE INDEX IF NOT EXISTS dm_messages_thread_idx
        ON dm_messages (thread_id, created_at DESC);

      -- Read state per person per thread, for the unread badge.
      CREATE TABLE IF NOT EXISTS dm_reads (
        thread_id    uuid NOT NULL REFERENCES dm_threads(id) ON DELETE CASCADE,
        user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        last_read_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (thread_id, user_id)
      );
    `,
  },
  {
    id: '003_site_settings_and_suggestions',
    sql: /* sql */ `
      -- Small key/value store for things an admin flips at runtime:
      -- maintenance mode and the global announcement.
      CREATE TABLE IF NOT EXISTS app_settings (
        key        text PRIMARY KEY,
        value      jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by uuid REFERENCES users(id) ON DELETE SET NULL
      );

      -- Member suggestions: a feature idea, or an audio file proposed for the
      -- collection. Uploaded files are quarantined outside MUSIC_ROOT until an
      -- admin accepts them, so nothing unreviewed is ever scanned or served.
      CREATE TABLE IF NOT EXISTS suggestions (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
        kind        text NOT NULL CHECK (kind IN ('feature', 'track')),
        body        text,
        -- What the member called it, kept only for display.
        file_name   text,
        -- Random name in the quarantine directory; never user-controlled.
        stored_file text,
        mime        text,
        bytes       bigint,
        status      text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'accepted', 'denied')),
        review_note text,
        reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at timestamptz,
        -- Where it landed in the library once accepted.
        library_path text,
        created_at  timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT suggestions_has_content
          CHECK (body IS NOT NULL OR stored_file IS NOT NULL)
      );

      CREATE INDEX IF NOT EXISTS suggestions_status_idx
        ON suggestions (status, created_at DESC);
      CREATE INDEX IF NOT EXISTS suggestions_user_idx ON suggestions (user_id);
    `,
  },
  {
    id: '004_suggestion_content_check',
    sql: /* sql */ `
      -- Denying an upload deletes the file and clears stored_file, which left a
      -- track suggestion carrying neither a body nor a file. A track row is
      -- meaningful on its own — it still records who proposed what, and when —
      -- so the constraint now allows it.
      ALTER TABLE suggestions DROP CONSTRAINT IF EXISTS suggestions_has_content;
      ALTER TABLE suggestions ADD CONSTRAINT suggestions_has_content
        CHECK (body IS NOT NULL OR stored_file IS NOT NULL OR kind = 'track');
    `,
  },
  {
    id: '005_presence_and_parties',
    sql: /* sql */ `
      -- Who may see what you are listening to. 'friends' is the default: the
      -- feature is for friends, and an account that never opens settings should
      -- not end up broadcasting to the whole invite list.
      ALTER TABLE users ADD COLUMN IF NOT EXISTS status_visibility text NOT NULL DEFAULT 'friends';
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_visibility_check;
      ALTER TABLE users ADD CONSTRAINT users_status_visibility_check
        CHECK (status_visibility IN ('everyone', 'friends', 'nobody'));

      -- Opt out of listen-along invites without hiding your status.
      ALTER TABLE users ADD COLUMN IF NOT EXISTS allow_party_invites boolean NOT NULL DEFAULT true;

      /*
       * The current track, one row per person, overwritten on every heartbeat.
       *
       * The track is denormalised rather than joined against the library: the
       * index lives in memory in the API process and is rebuilt by a rescan, so
       * a status that outlived a re-tag still renders instead of going blank.
       * Staleness is decided at read time from updated_at, so a browser that
       * disappears (closed lid, dead battery) simply stops being "live" —
       * nothing has to run to clean up after it.
       */
      CREATE TABLE IF NOT EXISTS listening_status (
        user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        track_id   text NOT NULL,
        title      text NOT NULL,
        artist     text NOT NULL,
        album      text,
        album_id   text,
        cover_id   text,
        duration   double precision,
        position   double precision NOT NULL DEFAULT 0,
        is_playing boolean NOT NULL DEFAULT false,
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS listening_status_updated_idx ON listening_status (updated_at DESC);

      -- A listen-along session. The host's player is the source of truth; the
      -- row is the mirror everyone else reads.
      CREATE TABLE IF NOT EXISTS listen_parties (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        host_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        track_id    text,
        title       text,
        artist      text,
        album       text,
        album_id    text,
        cover_id    text,
        duration    double precision,
        position    double precision NOT NULL DEFAULT 0,
        is_playing  boolean NOT NULL DEFAULT false,
        -- When the position above was sampled, so a guest can work out where
        -- the host is now, rather than where they were when the row was written.
        position_at timestamptz NOT NULL DEFAULT now(),
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        ended_at    timestamptz
      );

      -- At most one live party per host; ended ones keep their row for the
      -- invite messages that point at them.
      CREATE UNIQUE INDEX IF NOT EXISTS listen_parties_one_live_per_host
        ON listen_parties (host_id) WHERE ended_at IS NULL;

      CREATE TABLE IF NOT EXISTS listen_party_members (
        party_id     uuid NOT NULL REFERENCES listen_parties(id) ON DELETE CASCADE,
        user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        joined_at    timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (party_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS listen_party_members_user_idx ON listen_party_members (user_id);
    `,
  },
  {
    id: '006_listen_along_visibility',
    sql: /* sql */ `
      /*
       * Listening along is now something people join from your profile rather
       * than something you invite them to, so the yes/no invite switch becomes
       * an audience — the same shape as the status setting next to it.
       */
      ALTER TABLE users ADD COLUMN IF NOT EXISTS listen_along_visibility text NOT NULL DEFAULT 'friends';
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_listen_along_visibility_check;
      ALTER TABLE users ADD CONSTRAINT users_listen_along_visibility_check
        CHECK (listen_along_visibility IN ('everyone', 'friends', 'nobody'));

      -- Anyone who had turned invites off had said no; keep them at no.
      UPDATE users SET listen_along_visibility = 'nobody'
       WHERE allow_party_invites = false;

      ALTER TABLE users DROP COLUMN IF EXISTS allow_party_invites;
    `,
  },
];
