import { apiUrl } from './config';
import type {
  AccountUser,
  AdminAccountUser,
  Album,
  Attachment,
  AlbumDetail,
  Artist,
  ArtistDetail,
  AuthContextInfo,
  EmojiResult,
  FriendStatus,
  FriendSummary,
  GifResult,
  Invite,
  LibraryStats,
  Message,
  NowPlaying,
  Page,
  PartyState,
  PendingProfile,
  PrivacySettings,
  PublicProfile,
  SearchResults,
  SiteSettings,
  SortKey,
  StickerProviders,
  Suggestion,
  ThreadSummary,
  Track,
} from './types';

/** Thrown for any non-2xx response so the UI can show a real message. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Machine-readable reason, e.g. `invite_expired` or `unauthenticated`. */
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      ...init,
      // The session lives in an httpOnly cookie, so every call must send
      // credentials — including cross-origin ones when the frontend is hosted
      // separately from the Pi.
      credentials: 'include',
      headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError(
      'Could not reach the archive server. Check that the backend is running and that the API URL is correct.',
      0,
    );
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    let code: string | undefined;
    try {
      const body = (await response.json()) as { error?: string; code?: string };
      if (body?.error) message = body.error;
      code = body?.code;
    } catch {
      // Non-JSON error body — keep the generic message.
    }
    throw new ApiError(message, response.status, code);
  }

  return (await response.json()) as T;
}

export interface ListParams {
  q?: string;
  genre?: string;
  year?: number;
  sort?: SortKey;
  limit?: number;
  offset?: number;
  artistId?: string;
  albumId?: string;
}

function qs(params: ListParams = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : '';
}

function jsonRequest<T>(path: string, method: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {
    // Marks the call as coming from our own client. The server requires either
    // a matching Origin or this header on cookie-authenticated writes, which is
    // what stops a third-party page acting as the user.
    'X-Requested-With': 'boozie-archive',
  };

  /**
   * Only declare a JSON body when there is one.
   *
   * Fastify rejects `Content-Type: application/json` with an empty body as a
   * 400, which silently broke every POST that takes no arguments — logout
   * above all: the request failed, the session stayed alive on the server, and
   * the client cleared its own state anyway, so it only *looked* signed out
   * until the next page load restored it.
   */
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  return request<T>(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const auth = {
  context: () => request<AuthContextInfo>('/api/auth/context'),
  me: () => request<{ user: AccountUser | null }>('/api/auth/me'),
  login: (username: string, password: string) =>
    jsonRequest<{ user: AccountUser }>('/api/auth/login', 'POST', { username, password }),
  register: (input: { username: string; password: string; inviteCode?: string }) =>
    jsonRequest<{ user: AccountUser }>('/api/auth/register', 'POST', input),
  logout: () => jsonRequest<{ ok: true }>('/api/auth/logout', 'POST'),
  checkInvite: (code: string) =>
    request<{ valid: boolean; reason?: string }>(`/api/auth/invite/${encodeURIComponent(code)}`),
  changePassword: (currentPassword: string, newPassword: string) =>
    jsonRequest<{ ok: true }>('/api/auth/password', 'POST', { currentPassword, newPassword }),
};

export const suggestions = {
  mine: () =>
    request<{ suggestions: Suggestion[]; accepts: string[]; maxBytes: number }>(
      '/api/suggestions/mine',
    ),
  create: (body: string) =>
    jsonRequest<{ suggestion: Suggestion }>('/api/suggestions', 'POST', { body }),
  upload: (file: File, note: string) => {
    const form = new FormData();
    // The note goes first so the server has it by the time the file arrives.
    form.append('note', note);
    form.append('file', file);
    return request<{ suggestion: Suggestion }>('/api/suggestions/upload', {
      method: 'POST',
      headers: { 'X-Requested-With': 'boozie-archive' },
      body: form,
    });
  },
};

export const admin = {
  settings: () =>
    request<{ settings: SiteSettings; pendingSuggestions: number }>('/api/admin/settings'),
  setMaintenance: (enabled: boolean, message?: string) =>
    jsonRequest<{ settings: SiteSettings }>('/api/admin/settings/maintenance', 'PUT', {
      enabled,
      message,
    }),
  setAnnouncement: (enabled: boolean, message: string) =>
    jsonRequest<{ settings: SiteSettings }>('/api/admin/settings/announcement', 'PUT', {
      enabled,
      message,
    }),

  suggestions: (status?: string) =>
    request<{ suggestions: Suggestion[] }>(
      `/api/admin/suggestions${status ? `?status=${encodeURIComponent(status)}` : ''}`,
    ),
  /** Streams a quarantined upload so it can be listened to before deciding. */
  suggestionFileUrl: (id: string) => apiUrl(`/api/admin/suggestions/${encodeURIComponent(id)}/file`),
  acceptSuggestion: (id: string, note?: string) =>
    jsonRequest<{ suggestion: Suggestion }>(
      `/api/admin/suggestions/${encodeURIComponent(id)}/accept`,
      'POST',
      { note },
    ),
  denySuggestion: (id: string, note?: string) =>
    jsonRequest<{ suggestion: Suggestion }>(
      `/api/admin/suggestions/${encodeURIComponent(id)}/deny`,
      'POST',
      { note },
    ),

  invites: () => request<{ invites: Invite[] }>('/api/admin/invites'),
  createInvite: (input: { label?: string; expiresInSeconds: number | null; maxUses: number | null }) =>
    jsonRequest<{ invite: Invite }>('/api/admin/invites', 'POST', input),
  setInviteDisabled: (id: string, disabled: boolean) =>
    jsonRequest<{ invite: Invite }>(`/api/admin/invites/${encodeURIComponent(id)}`, 'PATCH', { disabled }),
  deleteInvite: (id: string) =>
    jsonRequest<{ ok: true }>(`/api/admin/invites/${encodeURIComponent(id)}`, 'DELETE'),

  users: () => request<{ users: AdminAccountUser[] }>('/api/admin/users'),
  updateUser: (id: string, patch: { role?: 'user' | 'admin'; disabled?: boolean }) =>
    jsonRequest<{ user: AccountUser }>(`/api/admin/users/${encodeURIComponent(id)}`, 'PATCH', patch),
  deleteUser: (id: string) =>
    jsonRequest<{ ok: true }>(`/api/admin/users/${encodeURIComponent(id)}`, 'DELETE'),
};

export const social = {
  // profiles
  myProfile: () => request<{ profile: PublicProfile }>('/api/profile/me'),
  updateProfile: (patch: {
    displayName?: string | null;
    bio?: string | null;
    avatarUrl?: string | null;
    accentColor?: string | null;
  }) => jsonRequest<{ profile: PublicProfile }>('/api/profile/me', 'PATCH', patch),
  profile: (username: string) =>
    request<{ profile: PublicProfile }>(`/api/profile/${encodeURIComponent(username)}`),

  /**
   * Uploads a profile picture. The body is multipart, so no JSON content type
   * here — the browser sets its own boundary — but the CSRF marker still goes
   * along, since this is a cookie-authenticated write.
   */
  uploadAvatar: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<{ profile: PublicProfile }>('/api/profile/me/avatar', {
      method: 'POST',
      headers: { 'X-Requested-With': 'boozie-archive' },
      body: form,
    });
  },
  removeAvatar: () => jsonRequest<{ profile: PublicProfile }>('/api/profile/me/avatar', 'DELETE'),
  searchUsers: (q: string) =>
    request<{ users: PublicProfile[] }>(`/api/users/search?q=${encodeURIComponent(q)}`),

  // friends
  friends: () =>
    request<{ friends: FriendSummary[]; incoming: PendingProfile[]; outgoing: PendingProfile[] }>(
      '/api/friends',
    ),
  addFriend: (userId: string) =>
    jsonRequest<{ status: FriendStatus }>('/api/friends/requests', 'POST', { userId }),
  acceptFriend: (friendshipId: string) =>
    jsonRequest<{ status: FriendStatus }>(
      `/api/friends/requests/${encodeURIComponent(friendshipId)}/accept`,
      'POST',
    ),
  removeFriend: (userId: string) =>
    jsonRequest<{ status: FriendStatus }>(`/api/friends/${encodeURIComponent(userId)}`, 'DELETE'),
  blockUser: (userId: string) =>
    jsonRequest<{ status: FriendStatus }>(`/api/friends/${encodeURIComponent(userId)}/block`, 'POST'),
  unblockUser: (userId: string) =>
    jsonRequest<{ status: FriendStatus }>(`/api/friends/${encodeURIComponent(userId)}/block`, 'DELETE'),

  // direct messages
  threads: () => request<{ threads: ThreadSummary[] }>('/api/dm/threads'),
  openThread: (userId: string) =>
    jsonRequest<{ threadId: string }>('/api/dm/threads', 'POST', { userId }),
  messages: (threadId: string, before?: string) =>
    request<{ messages: Message[] }>(
      `/api/dm/threads/${encodeURIComponent(threadId)}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`,
    ),
  sendMessage: (threadId: string, input: { body?: string; attachment?: Attachment }) =>
    jsonRequest<{ message: Message }>(
      `/api/dm/threads/${encodeURIComponent(threadId)}/messages`,
      'POST',
      input,
    ),
  markRead: (threadId: string) =>
    jsonRequest<{ ok: true }>(`/api/dm/threads/${encodeURIComponent(threadId)}/read`, 'POST'),
  deleteMessage: (messageId: string) =>
    jsonRequest<{ ok: true }>(`/api/dm/messages/${encodeURIComponent(messageId)}`, 'DELETE'),

  badges: () => request<{ messages: number; friendRequests: number }>('/api/social/badges'),
};

/** Listening status, its privacy controls, and listen-along sessions. */
export const presence = {
  /**
   * Reports the player's state. `now` is null when nothing is loaded, which
   * retracts the status rather than letting it linger until it expires.
   */
  heartbeat: (now: NowPlayingInput | null) =>
    jsonRequest<{ now: NowPlaying | null; party: PartyState | null }>('/api/presence', 'PUT', {
      now,
    }),
  friends: () => request<{ statuses: Record<string, NowPlaying> }>('/api/presence/friends'),

  privacy: () => request<PrivacySettings>('/api/presence/privacy'),
  setPrivacy: (patch: Partial<PrivacySettings>) =>
    jsonRequest<PrivacySettings>('/api/presence/privacy', 'PATCH', patch),

  currentParty: () => request<{ party: PartyState | null }>('/api/parties/current'),
  startParty: () => jsonRequest<{ party: PartyState }>('/api/parties', 'POST'),
  party: (id: string) => request<{ party: PartyState }>(`/api/parties/${encodeURIComponent(id)}`),
  joinParty: (id: string) =>
    jsonRequest<{ party: PartyState }>(`/api/parties/${encodeURIComponent(id)}/join`, 'POST'),
  leaveParty: (id: string) =>
    jsonRequest<{ ok: true }>(`/api/parties/${encodeURIComponent(id)}/leave`, 'POST'),
  invite: (id: string, userId: string) =>
    jsonRequest<{ threadId: string; message: Message }>(
      `/api/parties/${encodeURIComponent(id)}/invite`,
      'POST',
      { userId },
    ),
};

/** What the player sends up; the server fills in the timestamps. */
export interface NowPlayingInput {
  trackId: string;
  title: string;
  artist: string;
  album: string | null;
  albumId: string | null;
  coverId: string | null;
  duration: number | null;
  position: number;
  isPlaying: boolean;
}

export const stickers = {
  providers: () => request<StickerProviders>('/api/stickers/providers'),
  gifs: (q: string, provider: 'giphy' | 'tenor') =>
    request<{ results: GifResult[] }>(
      `/api/stickers/gifs?provider=${provider}&q=${encodeURIComponent(q)}`,
    ),
  emojis: (q: string) =>
    request<{ results: EmojiResult[] }>(`/api/stickers/emojis?q=${encodeURIComponent(q)}`),
};

export const api = {
  stats: () => request<LibraryStats>('/api/stats'),
  health: () => request<{ status: string; indexed: boolean; scanning: boolean }>('/api/health'),

  artists: (params?: ListParams) => request<Page<Artist>>(`/api/artists${qs(params)}`),
  artist: (id: string) => request<ArtistDetail>(`/api/artists/${encodeURIComponent(id)}`),
  artistTracks: (id: string, params?: ListParams) =>
    request<Page<Track>>(`/api/artists/${encodeURIComponent(id)}/tracks${qs(params)}`),

  albums: (params?: ListParams) => request<Page<Album>>(`/api/albums${qs(params)}`),
  album: (id: string) => request<AlbumDetail>(`/api/albums/${encodeURIComponent(id)}`),

  tracks: (params?: ListParams) => request<Page<Track>>(`/api/tracks${qs(params)}`),
  track: (id: string) =>
    request<{ track: Track; album: Album | null; artist: Artist | null }>(
      `/api/tracks/${encodeURIComponent(id)}`,
    ),

  search: (q: string, limit = 6) => request<SearchResults>(`/api/search${qs({ q, limit })}`),
  genres: () => request<{ name: string; count: number }[]>('/api/genres'),
  years: () => request<{ year: number; count: number }[]>('/api/years'),
  recent: (limit = 18) => request<Album[]>(`/api/recent${qs({ limit })}`),
};

/** Media URLs are used directly by <audio>/<img>, so they are plain strings. */
export const mediaUrl = {
  stream: (trackId: string) => apiUrl(`/api/stream/${encodeURIComponent(trackId)}`),
  download: (trackId: string) => apiUrl(`/api/download/${encodeURIComponent(trackId)}`),
  cover: (id: string, size: 128 | 320 | 640 = 320) =>
    apiUrl(`/api/cover/${encodeURIComponent(id)}?size=${size}`),
};
