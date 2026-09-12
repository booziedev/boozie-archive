/** Mirrors the backend data model in backend/src/types.ts. */

export interface Track {
  id: string;
  path: string;
  title: string;
  artist: string;
  artistId: string;
  albumArtist: string;
  album: string;
  albumId: string;
  trackNo: number | null;
  discNo: number | null;
  year: number | null;
  genres: string[];
  duration: number | null;
  bitrate: number | null;
  sampleRate: number | null;
  bitsPerSample: number | null;
  channels: number | null;
  codec: string | null;
  container: string | null;
  lossless: boolean;
  ext: string;
  size: number;
  mtimeMs: number;
  hasEmbeddedCover: boolean;
  coverId: string | null;

  /**
   * Everything the tags carry beyond the basics. Absent means the file didn't
   * say so — most tracks have none of it.
   */
  credits?: Credits;
  bpm?: number;
  key?: string;
  mood?: string;
  isrc?: string;
  replayGain?: ReplayGain;
  lyrics?: string;
  lyricsFile?: string;
  work?: string;
  movement?: string;
}

/** Liner notes, as far as the file records them. */
export interface Credits {
  composer?: string[];
  conductor?: string[];
  lyricist?: string[];
  writer?: string[];
  remixer?: string[];
  engineer?: string[];
  producer?: string[];
  label?: string[];
  catalogNumber?: string[];
}

/** Loudness normalisation in dB, with the peak as a 0..1 ratio. */
export interface ReplayGain {
  trackGainDb?: number;
  trackPeak?: number;
  albumGainDb?: number;
}

/** A line of time-synced lyrics from an .lrc sidecar. */
export interface LyricLine {
  at: number;
  text: string;
}

export interface Lyrics {
  source: 'lrc' | 'tags';
  synced: LyricLine[];
  text: string;
}

export interface Album {
  id: string;
  name: string;
  artistId: string;
  artistName: string;
  year: number | null;
  genres: string[];
  trackCount: number;
  duration: number;
  formats: string[];
  lossless: boolean;
  addedAt: number;
  folder: string;
  hasCover: boolean;
  /** Digital booklets in the album folder, addressed by index when fetched. */
  booklets?: string[];
}

export interface Artist {
  id: string;
  name: string;
  albumCount: number;
  trackCount: number;
  duration: number;
  genres: string[];
  addedAt: number;
  hasCover: boolean;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface LibraryStats {
  artists: number;
  albums: number;
  tracks: number;
  duration: number;
  size: number;
  formats: { ext: string; count: number }[];
  genres: number;
  scannedAt: string | null;
  scanning: boolean;
}

export interface SearchResults {
  query: string;
  artists: Artist[];
  albums: Album[];
  tracks: Track[];
}

export interface AlbumDetail {
  album: Album;
  artist: Artist | null;
  tracks: Track[];
}

export interface ArtistDetail {
  artist: Artist;
  albums: Album[];
}

export type SortKey = 'name' | 'recent' | 'tracks' | 'year' | 'duration' | 'random';

// --- accounts, sessions and invites ----------------------------------------

export type Role = 'user' | 'admin';

export interface AccountUser {
  id: string;
  username: string;
  role: Role;
  disabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  /** Set while an admin has this account temporarily locked out. */
  timeoutUntil?: string | null;
}

export interface AdminAccountUser extends AccountUser {
  /** The invite code this account signed up with, if any. */
  inviteCode: string | null;
  sessionCount: number;
}

export interface AuthContextInfo {
  authEnabled: boolean;
  /** True on a fresh install: the first account created becomes the admin. */
  needsSetup: boolean;
  allowPublicBrowse: boolean;
  minPasswordLength?: number;
  /** Site state, readable even while the archive is closed. */
  maintenance?: { enabled: boolean; message: string };
  announcement?: { message: string; version: number } | null;
}

export type InviteStatus = 'active' | 'disabled' | 'expired' | 'exhausted';

export interface Invite {
  id: string;
  code: string;
  label: string | null;
  createdAt: string;
  createdBy: string | null;
  /** null means it never expires. */
  expiresAt: string | null;
  /** null means unlimited uses. */
  maxUses: number | null;
  uses: number;
  disabled: boolean;
  status: InviteStatus;
}

// --- profiles, friends and direct messages ---------------------------------

export type FriendStatus = 'none' | 'pending_out' | 'pending_in' | 'friends' | 'blocked';

export interface PublicProfile {
  id: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  accentColor: string | null;
  role: Role;
  createdAt: string;
  friendStatus: FriendStatus;
  /**
   * What they have playing, or null when they are quiet, offline, or have
   * chosen not to show it to whoever is looking.
   */
  listeningNow?: NowPlaying | null;
  /** Whether this account lets the viewer listen along with them. */
  canListenAlong?: boolean;
}

export interface FriendSummary extends PublicProfile {
  friendshipId: string;
  since: string;
}

export type PendingProfile = PublicProfile & { friendshipId: string };

/** A GIF, a custom emoji, or a piece of the library being shared. */
export type Attachment =
  | {
      kind: 'gif';
      url: string;
      previewUrl: string;
      width?: number;
      height?: number;
      provider: string;
      title?: string;
    }
  | { kind: 'emoji'; url: string; name: string; provider: string }
  | { kind: 'album' | 'artist' | 'track'; id: string; name: string; subtitle?: string }
  | { kind: 'playlist'; id: string; name: string; subtitle?: string };

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

export interface GifResult {
  id: string;
  url: string;
  previewUrl: string;
  width?: number;
  height?: number;
  title?: string;
  provider: 'giphy' | 'tenor';
}

export interface EmojiResult {
  id: string;
  name: string;
  url: string;
  provider: 'emoji.gg';
}

export interface StickerProviders {
  giphy: boolean;
  tenor: boolean;
  emojiGg: boolean;
}

// --- site settings and suggestions -----------------------------------------

export interface MaintenanceState {
  enabled: boolean;
  message: string;
}

export interface AnnouncementState {
  message: string;
  /** Bumped on every edit, so dismissing one doesn't hide the next. */
  version: number;
}

export interface SiteSettings {
  maintenance: MaintenanceState;
  announcement: { enabled: boolean; message: string; version: number; updatedAt: string | null };
}

export type SuggestionKind = 'feature' | 'track';
export type SuggestionStatus = 'pending' | 'accepted' | 'denied';

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  body: string | null;
  fileName: string | null;
  mime: string | null;
  bytes: number | null;
  status: SuggestionStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  libraryPath: string | null;
  createdAt: string;
  author: string | null;
  authorId: string | null;
}

// --- listening status and listen-along -------------------------------------

/** An audience: used for both the status and listening along. */
export type StatusVisibility = 'everyone' | 'friends' | 'nobody';

export interface PrivacySettings {
  statusVisibility: StatusVisibility;
  listenAlongVisibility: StatusVisibility;
}

/** A snapshot of somebody's player. */
export interface NowPlaying {
  trackId: string;
  title: string;
  artist: string;
  album: string | null;
  albumId: string | null;
  coverId: string | null;
  duration: number | null;
  position: number;
  isPlaying: boolean;
  /**
   * 'archive' when it is this site's own player. Anything else is the service
   * the listener told us they scrobble from, and becomes the word in front of
   * the track: "Spotify: Nightcall".
   */
  source: string;
  updatedAt: string;
}

export interface PartyListener {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface PartyState {
  id: string;
  hostId: string;
  hostUsername: string;
  hostDisplayName: string | null;
  now: NowPlaying | null;
  /** When the host's position was sampled, by the server's clock. */
  positionAt: string;
  /** The server's clock at the moment it answered, for drift correction. */
  serverTime: string;
  listeners: PartyListener[];
  live: boolean;
  isHost: boolean;
}

// --- listening history ------------------------------------------------------

/** Windows the history queries know how to build. */
export type HistoryRange = 'week' | 'month' | 'year' | 'all';

export interface PlayRecord {
  id: string;
  trackId: string;
  title: string;
  artist: string;
  album: string | null;
  albumId: string | null;
  msPlayed: number;
  completed: boolean;
  playedAt: string;
}

/** A row in a "most played" chart — a track, an artist or an album. */
export interface TopEntry {
  key: string;
  name: string;
  subtitle: string | null;
  albumId: string | null;
  plays: number;
  msPlayed: number;
}

export interface Recap {
  range: HistoryRange;
  from: string | null;
  plays: number;
  tracks: number;
  artists: number;
  albums: number;
  msPlayed: number;
  /** Hour of day, 0-23, with the most plays. Null with no history. */
  peakHour: number | null;
  firstPlayAt: string | null;
  topTracks: TopEntry[];
  topArtists: TopEntry[];
  topAlbums: TopEntry[];
}

/** A playlist, as the API returns it. */
export type PlaylistVisibility = 'everyone' | 'friends' | 'private';

export type PlaylistRole = 'viewer' | 'collaborator';

export interface PlaylistMember {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: PlaylistRole;
  addedAt: string;
}

export interface Playlist {
  id: string;
  ownerId: string;
  ownerUsername: string;
  ownerDisplayName: string | null;
  name: string;
  description: string | null;
  visibility: PlaylistVisibility;
  kind: 'manual' | 'wrapped';
  /** Which generator built it, when it was generated. */
  generator: 'top_year' | 'on_repeat' | 'time_capsule' | null;
  trackCount: number;
  duration: number;
  /** An uploaded cover; otherwise coverId's album art is used. */
  coverUrl: string | null;
  coverId: string | null;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
  /** What this viewer may do with it. */
  canEdit: boolean;
  isOwner: boolean;
  /** Their role, when they were invited rather than owning it. */
  role: PlaylistRole | null;
  /** Whether they have kept it in their library. */
  saved: boolean;
  /** When they kept it. Null for one of their own. */
  savedAt: string | null;
}

export interface PlaylistEntry {
  trackId: string;
  title: string;
  artist: string;
  album: string | null;
  albumId: string | null;
  duration: number | null;
  position: number;
  addedBy: string | null;
  addedAt: string;
  /** null when the id no longer resolves — the file was renamed or removed. */
  track: Track | null;
}

/** An internet radio station. Curated by an admin, shared with everyone. */
export interface Station {
  id: string;
  name: string;
  streamUrl: string;
  homepageUrl: string | null;
  faviconUrl: string | null;
  /** Artwork an admin uploaded; wins over the directory's favicon. */
  coverUrl: string | null;
  codec: string | null;
  bitrate: number | null;
  country: string | null;
  tags: string[];
  sortOrder: number;
  disabled: boolean;
  createdAt: string;
}

/** What the server found when it opened a stream URL. */
export interface StationProbe {
  streamUrl: string;
  name: string | null;
  codec: string | null;
  bitrate: number | null;
  contentType: string;
}

/** A hit from the Radio Browser directory, ready to be added. */
export interface DirectoryStation {
  name: string;
  streamUrl: string;
  homepageUrl: string | null;
  faviconUrl: string | null;
  codec: string | null;
  bitrate: number | null;
  country: string | null;
  tags: string[];
  votes: number;
}

/** One person playing something, as the admin Live tab sees them. */
export interface LiveListener {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: 'user' | 'admin';
  trackId: string;
  title: string;
  artist: string;
  album: string | null;
  albumId: string | null;
  coverId: string | null;
  duration: number | null;
  position: number;
  isPlaying: boolean;
  isRadio: boolean;
  /**
   * 'archive' for the player on this site, otherwise the service the listener
   * scrobbles from. Force-pause only reaches this site's player.
   */
  source: string;
  updatedAt: string;
  forcePauseAt: string | null;
  timeoutUntil: string | null;
}

export interface TimedOutUser {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  timeoutUntil: string;
}

// ------------------------------------------------- listening somewhere else

/** Services somebody can say they listen on. Purely a label they picked. */
export type ServiceLabel =
  | 'Spotify'
  | 'Apple Music'
  | 'Tidal'
  | 'YouTube Music'
  | 'Deezer'
  | 'SoundCloud'
  | 'Last.fm';

export interface ScrobbleConnection {
  provider: 'lastfm';
  username: string;
  label: ServiceLabel;
  enabled: boolean;
  connectedAt: string;
  lastPolledAt: string | null;
  lastScrobbleAt: string | null;
  lastError: string | null;
  /** False when the server has no Last.fm key, so the UI can say why. */
  configured: boolean;
}

export interface ExternalPlay {
  id: string;
  provider: 'lastfm';
  title: string;
  artist: string;
  album: string | null;
  imageUrl: string | null;
  playedAt: string;
}

export interface ExternalTop {
  key: string;
  name: string;
  subtitle: string | null;
  imageUrl: string | null;
  plays: number;
}

export interface ExternalSummary {
  range: 'week' | 'month' | 'year' | 'all';
  plays: number;
  tracks: number;
  artists: number;
  topTracks: ExternalTop[];
  topArtists: ExternalTop[];
}

// ------------------------------------------------------ the profile showcase

export type FeaturedKind = 'track' | 'artist' | 'album';
export type SlotCount = 3 | 5 | 10;

export interface FeaturedItem {
  /** Row id — what a reorder, a removal and an art upload all address. */
  id: string;
  kind: FeaturedKind;
  source: 'archive' | 'deezer';
  title: string;
  subtitle: string | null;
  /** Set while the archive still resolves it, so the tile can link. */
  libraryId: string | null;
  /** The id to hand CoverImage. Archive picks only. */
  coverId: string | null;
  /** The resolved track, so an archive pick plays from its tile. */
  track: Track | null;
  /** A ready-made path on this origin, or null for the placeholder. */
  artUrl: string | null;
  /** True when there is nothing here to open — a catalogue-only pick. */
  external: boolean;
}

export interface FeaturedList {
  slots: SlotCount;
  items: FeaturedItem[];
  /** Picks beyond the current slot count. Only ever sent to the owner. */
  hidden: FeaturedItem[];
}

export interface Showcase {
  tracks: FeaturedList;
  artists: FeaturedList;
  albums: FeaturedList;
}

/** One search result, from this archive or from the catalogue. */
export interface FeaturedCandidate {
  source: 'archive' | 'deezer';
  /** A library id for archive results; the catalogue's id otherwise. */
  id: string;
  kind: FeaturedKind;
  title: string;
  subtitle: string | null;
  artUrl: string | null;
}

export interface CandidateResults {
  archive: FeaturedCandidate[];
  catalogue: FeaturedCandidate[];
  /** Set when the catalogue half failed; the archive half still answered. */
  catalogueError: string | null;
}

// ----------------------------------------------------------------- favourites

export type FavouriteKind = 'track' | 'album' | 'artist';

/**
 * A saved entity, with when it was saved.
 *
 * Deliberately not `addedAt` — albums and artists already carry one of those,
 * meaning when the file arrived in the archive rather than when you kept it.
 */
export type Saved<T> = T & { savedAt: string };

export interface Favourites {
  /** Bare ids, so a heart anywhere can answer without a lookup. */
  ids: Record<FavouriteKind, string[]>;
  /** The same things resolved, newest first, for the Library grid. */
  items: {
    tracks: Saved<Track>[];
    albums: Saved<Album>[];
    artists: Saved<Artist>[];
  };
}
