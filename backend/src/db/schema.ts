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
];
