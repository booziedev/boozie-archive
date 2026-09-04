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
];
