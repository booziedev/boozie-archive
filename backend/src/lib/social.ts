import { config, isAllowedAvatarUrl, isAllowedMediaUrl } from '../config.js';
import { pool } from '../db/pool.js';
import { AuthError } from './auth.js';
// Type-only: presence.ts imports this module at runtime, and a value import
// back would close the cycle. The routes are what actually join the two.
import type { NowPlaying } from './presence.js';

/**
 * Friends, direct messages and profiles.
 *
 * Two rules run through everything here:
 *  - a thread is addressed by the *pair of people*, never by an id the client
 *    supplies on its own, and every read re-checks membership. There is no
 *    query in this file that returns a message without proving the caller is
 *    one of the two participants;
 *  - anything that ends up rendered as a remote image (avatars, GIF and emoji
 *    attachments) is validated against the media host allowlist at write time.
 */

export type FriendStatus = 'none' | 'pending_out' | 'pending_in' | 'friends' | 'blocked';

export interface PublicProfile {
  id: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  accentColor: string | null;
  role: 'user' | 'admin';
  createdAt: string;
  /** Relationship between this profile and the person asking. */
  friendStatus: FriendStatus;
  /**
   * What they are playing, when their privacy setting lets this viewer see it.
   * Attached by the routes rather than the queries here, so a profile lookup
   * costs nothing extra where the status isn't wanted.
   */
  listeningNow?: NowPlaying | null;
  /** Whether the viewer is in the audience this account lets listen along. */
  canListenAlong?: boolean;
}

export interface FriendSummary extends PublicProfile {
  friendshipId: string;
  since: string;
}

export type Attachment =
  | { kind: 'gif'; url: string; previewUrl: string; width?: number; height?: number; provider: string; title?: string }
  | { kind: 'emoji'; url: string; name: string; provider: string }
  | { kind: 'album' | 'artist' | 'track'; id: string; name: string; subtitle?: string };

export interface Message {
  id: string;
  threadId: string;
  senderId: string;
  body: string | null;
  attachment: Attachment | null;
  createdAt: string;
  deleted: boolean;
}

export interface ThreadSummary {
  id: string;
  friend: PublicProfile;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unread: number;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// ------------------------------------------------------------------ profiles

interface ProfileRow {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  accent_color: string | null;
  role: 'user' | 'admin';
  created_at: Date;
}

function toProfile(row: ProfileRow, friendStatus: FriendStatus = 'none'): PublicProfile {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    bio: row.bio,
    avatarUrl: row.avatar_url,
    accentColor: row.accent_color,
    role: row.role,
    createdAt: row.created_at.toISOString(),
    friendStatus,
  };
}

const PROFILE_COLUMNS =
  'id, username, display_name, bio, avatar_url, accent_color, role, created_at';

export async function getProfile(viewerId: string, userId: string): Promise<PublicProfile | null> {
  const { rows } = await pool.query<ProfileRow>(
    `SELECT ${PROFILE_COLUMNS} FROM users WHERE id = $1 AND disabled = false`,
    [userId],
  );
  if (!rows[0]) return null;
  return toProfile(rows[0], await friendStatusBetween(viewerId, userId));
}

export async function getProfileByUsername(
  viewerId: string,
  username: string,
): Promise<PublicProfile | null> {
  const { rows } = await pool.query<ProfileRow>(
    `SELECT ${PROFILE_COLUMNS} FROM users WHERE lower(username) = lower($1) AND disabled = false`,
    [username],
  );
  if (!rows[0]) return null;
  return toProfile(rows[0], await friendStatusBetween(viewerId, rows[0].id));
}

/** The avatar currently stored on an account, for replace-and-delete. */
export async function currentAvatarUrl(userId: string): Promise<string | null> {
  const { rows } = await pool.query<{ avatar_url: string | null }>(
    'SELECT avatar_url FROM users WHERE id = $1',
    [userId],
  );
  return rows[0]?.avatar_url ?? null;
}

export async function updateProfile(
  userId: string,
  input: { displayName?: string | null; bio?: string | null; avatarUrl?: string | null; accentColor?: string | null },
): Promise<PublicProfile> {
  const displayName = input.displayName?.trim() || null;
  const bio = input.bio?.trim() || null;
  const avatarUrl = input.avatarUrl?.trim() || null;
  const accentColor = input.accentColor?.trim() || null;

  if (displayName && displayName.length > 48) {
    throw new AuthError('Display names can be at most 48 characters.', 400, 'invalid_profile');
  }
  if (bio && bio.length > 300) {
    throw new AuthError('Bios can be at most 300 characters.', 400, 'invalid_profile');
  }
  if (accentColor && !HEX_COLOR.test(accentColor)) {
    throw new AuthError('Accent colour must be a hex value like #7c5cff.', 400, 'invalid_profile');
  }
  // An avatar is rendered in other people's browsers, so it may only be an
  // upload stored here or a provider we already trust — never an arbitrary or
  // internal address.
  if (avatarUrl && !isAllowedAvatarUrl(avatarUrl)) {
    throw new AuthError(
      'Avatars must be uploaded here, or picked from the built-in picker.',
      400,
      'invalid_avatar',
    );
  }

  const { rows } = await pool.query<ProfileRow>(
    `UPDATE users
        SET display_name = $2, bio = $3, avatar_url = $4, accent_color = $5,
            profile_updated_at = now()
      WHERE id = $1
      RETURNING ${PROFILE_COLUMNS}`,
    [userId, displayName, bio, avatarUrl, accentColor],
  );
  if (!rows[0]) throw new AuthError('Account not found.', 404, 'not_found');
  return toProfile(rows[0], 'none');
}

/** Directory search, for finding someone to add. Never lists disabled accounts. */
export async function searchUsers(viewerId: string, query: string, limit = 20) {
  const term = query.trim();
  if (term.length < 1) return [];

  const { rows } = await pool.query<ProfileRow & { status: string | null; requester_id: string | null }>(
    `SELECT ${PROFILE_COLUMNS.split(', ').map((c) => `u.${c}`).join(', ')},
            f.status, f.requester_id
       FROM users u
       LEFT JOIN friendships f
         ON least(f.requester_id, f.addressee_id) = least(u.id, $1::uuid)
        AND greatest(f.requester_id, f.addressee_id) = greatest(u.id, $1::uuid)
      WHERE u.disabled = false
        AND u.id <> $1
        AND (u.username ILIKE '%' || $2 || '%' OR u.display_name ILIKE '%' || $2 || '%')
      ORDER BY u.username
      LIMIT $3`,
    [viewerId, term, Math.min(limit, 50)],
  );

  return rows.map((row) =>
    toProfile(row, statusFor(row.status, row.requester_id, viewerId)),
  );
}

function statusFor(
  status: string | null,
  requesterId: string | null,
  viewerId: string,
): FriendStatus {
  if (!status) return 'none';
  if (status === 'accepted') return 'friends';
  if (status === 'blocked') return 'blocked';
  if (status === 'pending') return requesterId === viewerId ? 'pending_out' : 'pending_in';
  return 'none';
}

// ------------------------------------------------------------------- friends

export async function friendStatusBetween(viewerId: string, otherId: string): Promise<FriendStatus> {
  if (viewerId === otherId) return 'none';
  const { rows } = await pool.query<{ status: string; requester_id: string }>(
    `SELECT status, requester_id FROM friendships
      WHERE least(requester_id, addressee_id) = least($1::uuid, $2::uuid)
        AND greatest(requester_id, addressee_id) = greatest($1::uuid, $2::uuid)`,
    [viewerId, otherId],
  );
  const row = rows[0];
  return row ? statusFor(row.status, row.requester_id, viewerId) : 'none';
}

/** Everyone whose request has been accepted. */
export async function listFriends(userId: string): Promise<FriendSummary[]> {
  const { rows } = await pool.query<ProfileRow & { friendship_id: string; since: Date }>(
    `SELECT ${PROFILE_COLUMNS.split(', ').map((c) => `u.${c}`).join(', ')},
            f.id AS friendship_id, f.updated_at AS since
       FROM friendships f
       JOIN users u
         ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
      WHERE f.status = 'accepted'
        AND $1 IN (f.requester_id, f.addressee_id)
        AND u.disabled = false
      ORDER BY lower(u.username)`,
    [userId],
  );

  return rows.map((row) => ({
    ...toProfile(row, 'friends'),
    friendshipId: row.friendship_id,
    since: row.since.toISOString(),
  }));
}

/** Requests waiting on this user, and requests they have sent. */
export async function listFriendRequests(userId: string) {
  const { rows } = await pool.query<
    ProfileRow & { friendship_id: string; requester_id: string; created_at_req: Date }
  >(
    `SELECT ${PROFILE_COLUMNS.split(', ').map((c) => `u.${c}`).join(', ')},
            f.id AS friendship_id, f.requester_id, f.created_at AS created_at_req
       FROM friendships f
       JOIN users u
         ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
      WHERE f.status = 'pending'
        AND $1 IN (f.requester_id, f.addressee_id)
        AND u.disabled = false
      ORDER BY f.created_at DESC`,
    [userId],
  );

  const incoming: (PublicProfile & { friendshipId: string })[] = [];
  const outgoing: (PublicProfile & { friendshipId: string })[] = [];

  for (const row of rows) {
    const entry = {
      ...toProfile(row, row.requester_id === userId ? 'pending_out' : 'pending_in'),
      friendshipId: row.friendship_id,
    };
    if (row.requester_id === userId) outgoing.push(entry);
    else incoming.push(entry);
  }

  return { incoming, outgoing };
}

export async function sendFriendRequest(userId: string, targetId: string) {
  if (userId === targetId) {
    throw new AuthError("You can't add yourself.", 400, 'invalid_target');
  }

  const { rows: target } = await pool.query('SELECT 1 FROM users WHERE id = $1 AND disabled = false', [
    targetId,
  ]);
  if (target.length === 0) throw new AuthError('That account does not exist.', 404, 'not_found');

  // Simple abuse guard: a burst of requests to strangers is the spam pattern.
  const { rows: recent } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM friendships
      WHERE requester_id = $1 AND created_at > now() - interval '1 hour'`,
    [userId],
  );
  if (Number.parseInt(recent[0]?.count ?? '0', 10) >= config.friendRequestsPerHour) {
    throw new AuthError('Too many friend requests just now — try again later.', 429, 'rate_limited');
  }

  const existing = await friendStatusBetween(userId, targetId);
  if (existing === 'friends') throw new AuthError('You are already friends.', 409, 'already_friends');
  if (existing === 'blocked') throw new AuthError('That request cannot be sent.', 403, 'blocked');
  if (existing === 'pending_out') throw new AuthError('Request already sent.', 409, 'already_pending');
  // They asked first: accept instead of creating a mirrored request.
  if (existing === 'pending_in') return acceptFriendRequestByUser(userId, targetId);

  await pool.query(
    `INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'pending')`,
    [userId, targetId],
  );
  return { status: 'pending_out' as FriendStatus };
}

/** Accepts by friendship id, proving the caller is the addressee. */
export async function acceptFriendRequest(userId: string, friendshipId: string) {
  const { rowCount } = await pool.query(
    `UPDATE friendships
        SET status = 'accepted', updated_at = now()
      WHERE id = $1 AND addressee_id = $2 AND status = 'pending'`,
    [friendshipId, userId],
  );
  if (!rowCount) throw new AuthError('No such friend request.', 404, 'not_found');
  return { status: 'friends' as FriendStatus };
}

async function acceptFriendRequestByUser(userId: string, requesterId: string) {
  await pool.query(
    `UPDATE friendships
        SET status = 'accepted', updated_at = now()
      WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'`,
    [requesterId, userId],
  );
  return { status: 'friends' as FriendStatus };
}

/** Declines, cancels or unfriends — all "remove the row", scoped to the pair. */
export async function removeFriendship(userId: string, otherId: string) {
  const { rowCount } = await pool.query(
    `DELETE FROM friendships
      WHERE least(requester_id, addressee_id) = least($1::uuid, $2::uuid)
        AND greatest(requester_id, addressee_id) = greatest($1::uuid, $2::uuid)
        AND status <> 'blocked'`,
    [userId, otherId],
  );
  if (!rowCount) throw new AuthError('No such friendship.', 404, 'not_found');
  return { status: 'none' as FriendStatus };
}

export async function blockUser(userId: string, targetId: string) {
  if (userId === targetId) throw new AuthError("You can't block yourself.", 400, 'invalid_target');

  await pool.query(
    `INSERT INTO friendships (requester_id, addressee_id, status, blocked_by)
     VALUES ($1, $2, 'blocked', $1)
     ON CONFLICT (least(requester_id, addressee_id), greatest(requester_id, addressee_id))
     DO UPDATE SET status = 'blocked', blocked_by = $1, updated_at = now()`,
    [userId, targetId],
  );
  return { status: 'blocked' as FriendStatus };
}

/** Only the person who blocked can lift it. */
export async function unblockUser(userId: string, targetId: string) {
  const { rowCount } = await pool.query(
    `DELETE FROM friendships
      WHERE least(requester_id, addressee_id) = least($1::uuid, $2::uuid)
        AND greatest(requester_id, addressee_id) = greatest($1::uuid, $2::uuid)
        AND status = 'blocked' AND blocked_by = $1`,
    [userId, targetId],
  );
  if (!rowCount) throw new AuthError('You have not blocked that account.', 404, 'not_found');
  return { status: 'none' as FriendStatus };
}

// -------------------------------------------------------------------- threads

function orderPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/**
 * Finds or creates the thread between two people.
 *
 * Messaging is friends-only: it keeps a public archive from turning into an
 * open inbox for whoever holds an invite code.
 */
export async function openThread(userId: string, otherId: string): Promise<string> {
  if (userId === otherId) throw new AuthError("You can't message yourself.", 400, 'invalid_target');

  const status = await friendStatusBetween(userId, otherId);
  if (status === 'blocked') throw new AuthError('That conversation is unavailable.', 403, 'blocked');
  if (status !== 'friends') {
    throw new AuthError('You can only message friends.', 403, 'not_friends');
  }

  const [a, b] = orderPair(userId, otherId);
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO dm_threads (user_a, user_b) VALUES ($1, $2)
     ON CONFLICT (user_a, user_b) DO UPDATE SET user_a = EXCLUDED.user_a
     RETURNING id`,
    [a, b],
  );
  return rows[0]!.id;
}

/** Membership check every thread-scoped query goes through first. */
async function assertMember(userId: string, threadId: string): Promise<{ otherId: string }> {
  const { rows } = await pool.query<{ user_a: string; user_b: string }>(
    'SELECT user_a, user_b FROM dm_threads WHERE id = $1',
    [threadId],
  );
  const thread = rows[0];
  // A non-member gets the same answer as a non-existent thread, so ids can't be
  // probed for existence.
  if (!thread || (thread.user_a !== userId && thread.user_b !== userId)) {
    throw new AuthError('Conversation not found.', 404, 'not_found');
  }
  return { otherId: thread.user_a === userId ? thread.user_b : thread.user_a };
}

export async function listThreads(userId: string): Promise<ThreadSummary[]> {
  const { rows } = await pool.query<
    ProfileRow & {
      thread_id: string;
      last_message_at: Date | null;
      last_body: string | null;
      last_attachment: Attachment | null;
      unread: string;
    }
  >(
    `SELECT t.id AS thread_id,
            t.last_message_at,
            ${PROFILE_COLUMNS.split(', ').map((c) => `u.${c}`).join(', ')},
            m.body AS last_body,
            m.attachment AS last_attachment,
            (SELECT count(*) FROM dm_messages n
              WHERE n.thread_id = t.id
                AND n.sender_id <> $1
                AND n.deleted_at IS NULL
                AND n.created_at > COALESCE(r.last_read_at, 'epoch'::timestamptz))::text AS unread
       FROM dm_threads t
       JOIN users u ON u.id = CASE WHEN t.user_a = $1 THEN t.user_b ELSE t.user_a END
       LEFT JOIN dm_reads r ON r.thread_id = t.id AND r.user_id = $1
       LEFT JOIN LATERAL (
              SELECT body, attachment FROM dm_messages
               WHERE thread_id = t.id AND deleted_at IS NULL
               ORDER BY created_at DESC LIMIT 1
            ) m ON true
      WHERE $1 IN (t.user_a, t.user_b)
        AND u.disabled = false
      ORDER BY t.last_message_at DESC NULLS LAST`,
    [userId],
  );

  return rows.map((row) => ({
    id: row.thread_id,
    friend: toProfile(row, 'friends'),
    lastMessageAt: row.last_message_at ? row.last_message_at.toISOString() : null,
    lastMessagePreview: previewOf(row.last_body, row.last_attachment),
    unread: Number.parseInt(row.unread, 10),
  }));
}

function previewOf(body: string | null, attachment: Attachment | null): string | null {
  if (body) return body.slice(0, 120);
  if (!attachment) return null;
  switch (attachment.kind) {
    case 'gif':
      return 'GIF';
    case 'emoji':
      return `:${attachment.name}:`;
    case 'album':
      return `Shared an album · ${attachment.name}`;
    case 'artist':
      return `Shared an artist · ${attachment.name}`;
    case 'track':
      return `Shared a track · ${attachment.name}`;
    default:
      return null;
  }
}

export async function listMessages(userId: string, threadId: string, before?: string, limit = 50) {
  await assertMember(userId, threadId);

  const { rows } = await pool.query<{
    id: string;
    thread_id: string;
    sender_id: string;
    body: string | null;
    attachment: Attachment | null;
    created_at: Date;
    deleted_at: Date | null;
  }>(
    `SELECT * FROM dm_messages
      WHERE thread_id = $1
        AND ($2::timestamptz IS NULL OR created_at < $2)
      ORDER BY created_at DESC
      LIMIT $3`,
    [threadId, before ?? null, Math.min(Math.max(limit, 1), 100)],
  );

  return rows
    .map<Message>((row) => ({
      id: row.id,
      threadId: row.thread_id,
      senderId: row.sender_id,
      body: row.deleted_at ? null : row.body,
      attachment: row.deleted_at ? null : row.attachment,
      createdAt: row.created_at.toISOString(),
      deleted: Boolean(row.deleted_at),
    }))
    .reverse();
}

/** Validates an attachment before it is stored. Returns the cleaned value. */
export function validateAttachment(raw: unknown): Attachment | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object') throw new AuthError('Invalid attachment.', 400, 'invalid_attachment');

  const value = raw as Record<string, unknown>;
  const kind = String(value.kind ?? '');

  if (kind === 'gif' || kind === 'emoji') {
    const url = String(value.url ?? '');
    const previewUrl = String(value.previewUrl ?? url);
    // Both URLs are rendered in the recipient's browser.
    if (!isAllowedMediaUrl(url) || !isAllowedMediaUrl(previewUrl)) {
      throw new AuthError('That image host is not allowed.', 400, 'invalid_attachment');
    }
    if (kind === 'gif') {
      return {
        kind: 'gif',
        url,
        previewUrl,
        width: Number.isFinite(Number(value.width)) ? Number(value.width) : undefined,
        height: Number.isFinite(Number(value.height)) ? Number(value.height) : undefined,
        provider: String(value.provider ?? 'giphy').slice(0, 20),
        title: value.title ? String(value.title).slice(0, 120) : undefined,
      };
    }
    return {
      kind: 'emoji',
      url,
      name: String(value.name ?? 'emoji').slice(0, 60),
      provider: String(value.provider ?? 'emoji.gg').slice(0, 20),
    };
  }

  if (kind === 'album' || kind === 'artist' || kind === 'track') {
    const id = String(value.id ?? '');
    if (!/^[a-z]{2}_[A-Za-z0-9_-]{1,32}$/.test(id)) {
      throw new AuthError('Invalid shared item.', 400, 'invalid_attachment');
    }
    return {
      kind,
      id,
      name: String(value.name ?? '').slice(0, 200),
      subtitle: value.subtitle ? String(value.subtitle).slice(0, 200) : undefined,
    };
  }

  throw new AuthError('Unsupported attachment.', 400, 'invalid_attachment');
}

export async function sendMessage(
  userId: string,
  threadId: string,
  input: { body?: string | null; attachment?: unknown },
): Promise<Message> {
  const { otherId } = await assertMember(userId, threadId);

  // Losing the friendship (or being blocked) closes the conversation.
  const status = await friendStatusBetween(userId, otherId);
  if (status !== 'friends') {
    throw new AuthError('You can only message friends.', 403, 'not_friends');
  }

  const body = typeof input.body === 'string' ? input.body.trim() : null;
  const attachment = validateAttachment(input.attachment ?? null);

  if (!body && !attachment) {
    throw new AuthError('Write something first.', 400, 'empty_message');
  }
  if (body && body.length > config.messageMaxLength) {
    throw new AuthError(
      `Messages can be at most ${config.messageMaxLength} characters.`,
      400,
      'message_too_long',
    );
  }

  const { rows: recent } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM dm_messages
      WHERE sender_id = $1 AND created_at > now() - interval '1 minute'`,
    [userId],
  );
  if (Number.parseInt(recent[0]?.count ?? '0', 10) >= config.messageRatePerMinute) {
    throw new AuthError('You are sending messages too quickly.', 429, 'rate_limited');
  }

  const { rows } = await pool.query<{
    id: string;
    created_at: Date;
  }>(
    `INSERT INTO dm_messages (thread_id, sender_id, body, attachment)
     VALUES ($1, $2, $3, $4)
     RETURNING id, created_at`,
    [threadId, userId, body, attachment ? JSON.stringify(attachment) : null],
  );

  await pool.query('UPDATE dm_threads SET last_message_at = now() WHERE id = $1', [threadId]);
  await markRead(userId, threadId);

  return {
    id: rows[0]!.id,
    threadId,
    senderId: userId,
    body,
    attachment,
    createdAt: rows[0]!.created_at.toISOString(),
    deleted: false,
  };
}

/** Soft-deletes your own message; the row stays so ordering is stable. */
export async function deleteMessage(userId: string, messageId: string) {
  const { rowCount } = await pool.query(
    `UPDATE dm_messages SET deleted_at = now()
      WHERE id = $1 AND sender_id = $2 AND deleted_at IS NULL`,
    [messageId, userId],
  );
  if (!rowCount) throw new AuthError('Message not found.', 404, 'not_found');
  return { ok: true };
}

export async function markRead(userId: string, threadId: string) {
  await pool.query(
    `INSERT INTO dm_reads (thread_id, user_id, last_read_at)
     VALUES ($1, $2, now())
     ON CONFLICT (thread_id, user_id) DO UPDATE SET last_read_at = now()`,
    [threadId, userId],
  );
  return { ok: true };
}

/** Total unread messages across every thread, for the nav badge. */
export async function unreadCount(userId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM dm_messages m
       JOIN dm_threads t ON t.id = m.thread_id
       LEFT JOIN dm_reads r ON r.thread_id = t.id AND r.user_id = $1
      WHERE $1 IN (t.user_a, t.user_b)
        AND m.sender_id <> $1
        AND m.deleted_at IS NULL
        AND m.created_at > COALESCE(r.last_read_at, 'epoch'::timestamptz)`,
    [userId],
  );
  return Number.parseInt(rows[0]?.count ?? '0', 10);
}

/** Pending friend requests waiting on this user, for the nav badge. */
export async function pendingRequestCount(userId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM friendships
      WHERE addressee_id = $1 AND status = 'pending'`,
    [userId],
  );
  return Number.parseInt(rows[0]?.count ?? '0', 10);
}
