import type { PoolClient } from 'pg';

import { config } from '../config.js';
import { pool } from '../db/pool.js';
import {
  createSessionToken,
  generateInviteCode,
  hashPassword,
  hashToken,
  verifyPassword,
} from './passwords.js';

/**
 * Accounts, sessions and invite codes.
 *
 * Everything that must not race — redeeming an invite, creating the first
 * account — happens inside a transaction with the relevant row locked, so two
 * simultaneous registrations can't both consume the last use of a code.
 */

export type Role = 'user' | 'admin';

export interface PublicUser {
  id: string;
  username: string;
  role: Role;
  disabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AdminUser extends PublicUser {
  inviteCode: string | null;
  sessionCount: number;
}

export type InviteStatus = 'active' | 'disabled' | 'expired' | 'exhausted';

export interface Invite {
  id: string;
  code: string;
  label: string | null;
  createdAt: string;
  createdBy: string | null;
  expiresAt: string | null;
  maxUses: number | null;
  uses: number;
  disabled: boolean;
  status: InviteStatus;
}

/** Raised for anything the user should see a specific message about. */
export class AuthError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = 'auth_error',
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: Role;
  disabled: boolean;
  created_at: Date;
  last_login_at: Date | null;
}

function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    disabled: row.disabled,
    createdAt: row.created_at.toISOString(),
    lastLoginAt: row.last_login_at ? row.last_login_at.toISOString() : null,
  };
}

// --------------------------------------------------------------- validation

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;

export function validateUsername(username: string): string {
  const trimmed = username.trim();
  if (!USERNAME_RE.test(trimmed)) {
    throw new AuthError(
      'Usernames must be 3–32 characters, using letters, numbers, dots, dashes or underscores.',
      400,
      'invalid_username',
    );
  }
  return trimmed;
}

export function validatePassword(password: string): string {
  if (password.length < config.minPasswordLength) {
    throw new AuthError(
      `Passwords must be at least ${config.minPasswordLength} characters.`,
      400,
      'weak_password',
    );
  }
  if (password.length > 512) {
    throw new AuthError('That password is too long.', 400, 'weak_password');
  }
  return password;
}

// -------------------------------------------------------------------- users

export async function countUsers(): Promise<number> {
  const { rows } = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM users');
  return Number.parseInt(rows[0]?.count ?? '0', 10);
}

export async function hasAdmin(): Promise<boolean> {
  const { rows } = await pool.query(`SELECT 1 FROM users WHERE role = 'admin' LIMIT 1`);
  return rows.length > 0;
}

export async function getUserById(id: string): Promise<PublicUser | null> {
  const { rows } = await pool.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] ? toPublicUser(rows[0]) : null;
}

/**
 * Registers an account.
 *
 * The very first account on a fresh database becomes the admin and needs no
 * invite — there is nobody to have issued one yet. Every account after that
 * must redeem a valid code.
 */
export async function register(input: {
  username: string;
  password: string;
  inviteCode?: string;
  ip?: string;
}): Promise<PublicUser> {
  const username = validateUsername(input.username);
  validatePassword(input.password);
  const passwordHash = await hashPassword(input.password);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the users table against a second concurrent bootstrap.
    await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
    const { rows: existing } = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM users',
    );
    const isFirstUser = Number.parseInt(existing[0]?.count ?? '0', 10) === 0;

    let inviteId: string | null = null;
    if (!isFirstUser) {
      const code = (input.inviteCode ?? '').trim();
      if (!code) throw new AuthError('An invite code is required.', 400, 'invite_required');
      inviteId = await consumeInvite(client, code);
    }

    let user: UserRow;
    try {
      const { rows } = await client.query<UserRow>(
        `INSERT INTO users (username, password_hash, role, invite_id)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [username, passwordHash, isFirstUser ? 'admin' : 'user', inviteId],
      );
      user = rows[0]!;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new AuthError('That username is already taken.', 409, 'username_taken');
      }
      throw error;
    }

    if (inviteId) {
      await client.query(
        'INSERT INTO invite_redemptions (invite_id, user_id, ip) VALUES ($1, $2, $3)',
        [inviteId, user.id, input.ip ?? null],
      );
    }

    await client.query('COMMIT');
    return toPublicUser(user);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Validates and consumes one use of an invite code, with the row locked so the
 * use count can never overshoot `max_uses`.
 */
async function consumeInvite(client: PoolClient, code: string): Promise<string> {
  const { rows } = await client.query<{
    id: string;
    disabled: boolean;
    expires_at: Date | null;
    max_uses: number | null;
    uses: number;
  }>('SELECT id, disabled, expires_at, max_uses, uses FROM invites WHERE lower(code) = lower($1) FOR UPDATE', [
    code,
  ]);

  const invite = rows[0];
  if (!invite) throw new AuthError('That invite code does not exist.', 400, 'invite_invalid');
  if (invite.disabled) throw new AuthError('That invite code has been disabled.', 400, 'invite_disabled');
  if (invite.expires_at && invite.expires_at.getTime() <= Date.now()) {
    throw new AuthError('That invite code has expired.', 400, 'invite_expired');
  }
  if (invite.max_uses !== null && invite.uses >= invite.max_uses) {
    throw new AuthError('That invite code has already been used up.', 400, 'invite_exhausted');
  }

  await client.query('UPDATE invites SET uses = uses + 1 WHERE id = $1', [invite.id]);
  return invite.id;
}

/** Verifies credentials. Returns null for any failure, without saying which. */
export async function login(username: string, password: string): Promise<PublicUser | null> {
  const { rows } = await pool.query<UserRow>('SELECT * FROM users WHERE lower(username) = lower($1)', [
    username.trim(),
  ]);
  const row = rows[0];

  if (!row) {
    // Spend comparable time on unknown usernames so the response time doesn't
    // reveal whether an account exists.
    await verifyPassword(password, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');
    return null;
  }

  const valid = await verifyPassword(password, row.password_hash);
  if (!valid) return null;
  if (row.disabled) throw new AuthError('This account has been disabled.', 403, 'account_disabled');

  await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [row.id]);
  return toPublicUser({ ...row, last_login_at: new Date() });
}

export async function changePassword(userId: string, currentPassword: string, nextPassword: string) {
  const { rows } = await pool.query<UserRow>('SELECT * FROM users WHERE id = $1', [userId]);
  const row = rows[0];
  if (!row) throw new AuthError('Account not found.', 404, 'not_found');
  if (!(await verifyPassword(currentPassword, row.password_hash))) {
    throw new AuthError('Your current password is incorrect.', 400, 'bad_password');
  }
  validatePassword(nextPassword);
  const hash = await hashPassword(nextPassword);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, userId]);
  // Every other device is signed out; the current session is re-issued by the route.
  await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

// ----------------------------------------------------------------- sessions

export async function createSession(
  userId: string,
  meta: { userAgent?: string; ip?: string },
): Promise<{ token: string; expiresAt: Date }> {
  const { token, hash } = createSessionToken();
  const expiresAt = new Date(Date.now() + config.sessionTtlDays * 86_400_000);

  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, hash, expiresAt, meta.userAgent?.slice(0, 400) ?? null, meta.ip ?? null],
  );

  return { token, expiresAt };
}

/** Resolves a session cookie to its user, or null if it is invalid or expired. */
export async function resolveSession(token: string): Promise<PublicUser | null> {
  if (!token) return null;
  const { rows } = await pool.query<UserRow & { session_id: string }>(
    `SELECT u.*, s.id AS session_id
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );

  const row = rows[0];
  if (!row) return null;
  if (row.disabled) return null;

  // Cheap liveness tracking: only write once a minute per session.
  void pool
    .query(`UPDATE sessions SET last_seen_at = now() WHERE id = $1 AND last_seen_at < now() - interval '1 minute'`, [
      row.session_id,
    ])
    .catch(() => undefined);

  return toPublicUser(row);
}

export async function destroySession(token: string): Promise<void> {
  if (!token) return;
  await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

export async function pruneExpiredSessions(): Promise<number> {
  const result = await pool.query('DELETE FROM sessions WHERE expires_at < now()');
  return result.rowCount ?? 0;
}

// ------------------------------------------------------------------ invites

function inviteStatus(row: {
  disabled: boolean;
  expires_at: Date | null;
  max_uses: number | null;
  uses: number;
}): InviteStatus {
  if (row.disabled) return 'disabled';
  if (row.expires_at && row.expires_at.getTime() <= Date.now()) return 'expired';
  if (row.max_uses !== null && row.uses >= row.max_uses) return 'exhausted';
  return 'active';
}

interface InviteRow {
  id: string;
  code: string;
  label: string | null;
  created_at: Date;
  created_by: string | null;
  creator_name: string | null;
  expires_at: Date | null;
  max_uses: number | null;
  uses: number;
  disabled: boolean;
}

function toInvite(row: InviteRow): Invite {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    createdAt: row.created_at.toISOString(),
    createdBy: row.creator_name,
    expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
    maxUses: row.max_uses,
    uses: row.uses,
    disabled: row.disabled,
    status: inviteStatus(row),
  };
}

export async function listInvites(): Promise<Invite[]> {
  const { rows } = await pool.query<InviteRow>(
    `SELECT i.*, u.username AS creator_name
       FROM invites i
       LEFT JOIN users u ON u.id = i.created_by
      ORDER BY i.created_at DESC`,
  );
  return rows.map(toInvite);
}

export async function createInvite(input: {
  createdBy: string;
  label?: string | null;
  /** Seconds until expiry; null/0 means it never expires. */
  expiresInSeconds?: number | null;
  /** null means unlimited uses. */
  maxUses?: number | null;
}): Promise<Invite> {
  const expiresAt =
    input.expiresInSeconds && input.expiresInSeconds > 0
      ? new Date(Date.now() + input.expiresInSeconds * 1000)
      : null;

  const maxUses =
    input.maxUses === null || input.maxUses === undefined || input.maxUses <= 0
      ? null
      : Math.min(Math.trunc(input.maxUses), 10_000);

  // Retry on the astronomically unlikely code collision.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateInviteCode();
    try {
      const { rows } = await pool.query<InviteRow>(
        `WITH inserted AS (
           INSERT INTO invites (code, label, created_by, expires_at, max_uses)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *
         )
         SELECT inserted.*, u.username AS creator_name
           FROM inserted
           LEFT JOIN users u ON u.id = inserted.created_by`,
        [code, input.label?.trim() || null, input.createdBy, expiresAt, maxUses],
      );
      return toInvite(rows[0]!);
    } catch (error) {
      if ((error as { code?: string }).code !== '23505') throw error;
    }
  }
  throw new AuthError('Could not generate a unique invite code, please try again.', 500, 'code_collision');
}

export async function setInviteDisabled(id: string, disabled: boolean): Promise<Invite | null> {
  const { rows } = await pool.query<InviteRow>(
    `UPDATE invites SET disabled = $2 WHERE id = $1 RETURNING *, NULL::text AS creator_name`,
    [id, disabled],
  );
  return rows[0] ? toInvite(rows[0]) : null;
}

export async function deleteInvite(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM invites WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

/** Public pre-check so the register form can validate a code before submitting. */
export async function peekInvite(code: string): Promise<{ valid: boolean; reason?: string }> {
  const { rows } = await pool.query<InviteRow>(
    'SELECT *, NULL::text AS creator_name FROM invites WHERE lower(code) = lower($1)',
    [code.trim()],
  );
  const row = rows[0];
  if (!row) return { valid: false, reason: 'That invite code does not exist.' };

  switch (inviteStatus(row)) {
    case 'disabled':
      return { valid: false, reason: 'That invite code has been disabled.' };
    case 'expired':
      return { valid: false, reason: 'That invite code has expired.' };
    case 'exhausted':
      return { valid: false, reason: 'That invite code has already been used up.' };
    default:
      return { valid: true };
  }
}

// -------------------------------------------------------------- admin: users

export async function listUsers(): Promise<AdminUser[]> {
  const { rows } = await pool.query<
    UserRow & { invite_code: string | null; session_count: string }
  >(
    // Columns are listed explicitly: `u.*` would pull every password hash in
    // the database into memory for a page that only shows names and roles.
    `SELECT u.id, u.username, u.role, u.disabled, u.created_at, u.last_login_at,
            i.code AS invite_code,
            (SELECT count(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > now())::text
              AS session_count
       FROM users u
       LEFT JOIN invites i ON i.id = u.invite_id
      ORDER BY u.created_at ASC`,
  );

  return rows.map((row) => ({
    ...toPublicUser(row),
    inviteCode: row.invite_code,
    sessionCount: Number.parseInt(row.session_count, 10),
  }));
}

export async function setUserRole(id: string, role: Role): Promise<PublicUser | null> {
  if (role !== 'admin') await assertNotLastAdmin(id);
  const { rows } = await pool.query<UserRow>('UPDATE users SET role = $2 WHERE id = $1 RETURNING *', [
    id,
    role,
  ]);
  return rows[0] ? toPublicUser(rows[0]) : null;
}

export async function setUserDisabled(id: string, disabled: boolean): Promise<PublicUser | null> {
  if (disabled) await assertNotLastAdmin(id);
  const { rows } = await pool.query<UserRow>(
    'UPDATE users SET disabled = $2 WHERE id = $1 RETURNING *',
    [id, disabled],
  );
  // Disabling someone should log them out everywhere, immediately.
  if (disabled) await pool.query('DELETE FROM sessions WHERE user_id = $1', [id]);
  return rows[0] ? toPublicUser(rows[0]) : null;
}

export async function deleteUser(id: string): Promise<boolean> {
  await assertNotLastAdmin(id);
  const result = await pool.query('DELETE FROM users WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

/** Guards against locking yourself out of your own admin panel. */
async function assertNotLastAdmin(id: string): Promise<void> {
  const { rows } = await pool.query<{ role: Role }>('SELECT role FROM users WHERE id = $1', [id]);
  if (rows[0]?.role !== 'admin') return;
  const { rows: admins } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM users WHERE role = 'admin' AND disabled = false`,
  );
  if (Number.parseInt(admins[0]?.count ?? '0', 10) <= 1) {
    throw new AuthError(
      'This is the only active admin account — promote another admin first.',
      400,
      'last_admin',
    );
  }
}

/** Used by the CLI to create or promote an admin outside the web UI. */
export async function upsertAdmin(username: string, password: string): Promise<PublicUser> {
  const name = validateUsername(username);
  validatePassword(password);
  const hash = await hashPassword(password);

  const { rows } = await pool.query<UserRow>(
    `INSERT INTO users (username, password_hash, role)
     VALUES ($1, $2, 'admin')
     ON CONFLICT (lower(username))
     DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin', disabled = false
     RETURNING *`,
    [name, hash],
  );
  return toPublicUser(rows[0]!);
}
