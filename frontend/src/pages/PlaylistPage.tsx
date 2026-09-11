import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  Download,
  ListMusic,
  Loader2,
  Lock,
  Pencil,
  Play,
  RefreshCw,
  Shuffle,
  Users,
  X,
} from 'lucide-react';

import { CoverImage } from '../components/CoverImage';
import { PlaylistEditor } from '../components/PlaylistEditor';
import { PlaylistMembers } from '../components/PlaylistMembers';
import { SavePlaylistButton } from '../components/SavePlaylistButton';
import { ShareButton } from '../components/ShareDialog';
import { EmptyState } from '../components/states';
import { mediaUrl, playlists as api } from '../lib/api';
import { formatBytes, formatDuration, formatRuntime } from '../lib/format';
import { usePlayer } from '../context/PlayerContext';
import type { PlaylistEntry, Track } from '../lib/types';

/** The tracks that still resolve, in order — the ones that can be played. */
function playable(entries: PlaylistEntry[]): Track[] {
  return entries.map((entry) => entry.track).filter((track): track is Track => Boolean(track));
}

export function PlaylistPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { current, isPlaying, playTracks, toggle } = usePlayer();
  const [editing, setEditing] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);

  const query = useQuery({
    queryKey: ['playlist', id],
    queryFn: () => api.get(id),
    retry: false,
  });

  const playlist = query.data?.playlist;
  const entries = query.data?.entries ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['playlist', id] });
    queryClient.invalidateQueries({ queryKey: ['playlists'] });
  };

  const refresh = useMutation({
    mutationFn: () =>
      playlist?.generator
        ? api.refreshWrapped(playlist.generator)
        : Promise.reject(new Error('Nothing to rebuild.')),
    onSuccess: invalidate,
  });

  const removeTrack = useMutation({
    mutationFn: (trackId: string) => api.removeTrack(id, trackId),
    onSuccess: invalidate,
  });

  const move = useMutation({
    mutationFn: ({ trackId, to }: { trackId: string; to: number }) => api.moveTrack(id, trackId, to),
    onSuccess: invalidate,
  });

  if (query.isLoading) {
    return <div className="h-40 animate-pulse rounded-2xl bg-white/[0.03]" />;
  }

  if (query.isError || !playlist) {
    return (
      <EmptyState
        icon={<ListMusic size={24} />}
        title="Playlist not found"
        description="It may have been deleted, or it isn't shared with you."
        action={
          <Link to="/playlists" className="btn-ghost">
            Back to playlists
          </Link>
        }
      />
    );
  }

  const tracks = playable(entries);
  const missing = entries.length - tracks.length;
  // What the archive will actually weigh — only the tracks that still resolve.
  const playlistBytes = tracks.reduce((sum, track) => sum + track.size, 0);

  return (
    <div>
      <header className="mb-6 flex flex-col gap-5 sm:flex-row sm:items-end">
        <div className="h-40 w-40 shrink-0">
          {playlist.coverUrl ? (
            <img
              src={playlist.coverUrl}
              alt=""
              className="h-40 w-40 rounded-2xl bg-ink-800 object-cover shadow-card"
            />
          ) : (
            <CoverImage
              id={playlist.coverId ?? ''}
              name={playlist.name}
              size={320}
              rounded="rounded-2xl"
              className="h-40 w-40 shadow-card"
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-accent-400">
            {playlist.kind === 'wrapped' ? 'Your listening' : 'Playlist'}
            {playlist.visibility === 'private' && (
              <Lock size={10} className="text-zinc-600" aria-label="Private" />
            )}
          </p>

          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
            {playlist.name}
          </h1>
          {playlist.description && (
            <p className="mt-1 text-sm text-zinc-400">{playlist.description}</p>
          )}

          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-500">
            {/* A generated list is built from your own listening, so naming an
                owner would only be telling you about yourself. */}
            {playlist.kind === 'manual' && (
              <>
                <Link
                  to={`/u/${playlist.ownerUsername}`}
                  className="font-medium text-zinc-300 transition-colors hover:text-white hover:underline"
                >
                  {playlist.ownerDisplayName || playlist.ownerUsername}
                </Link>
                <span aria-hidden>·</span>
              </>
            )}
            <span>
              {playlist.trackCount} {playlist.trackCount === 1 ? 'track' : 'tracks'}
            </span>
            {playlist.trackCount > 0 && (
              <>
                <span aria-hidden>·</span>
                <span>{formatRuntime(playlist.duration)}</span>
              </>
            )}
            {playlist.kind === 'manual' && (playlist.isOwner || playlist.memberCount > 0) && (
              <button
                type="button"
                onClick={() => setMembersOpen(true)}
                aria-label="Who this playlist is shared with"
                title={
                  playlist.memberCount === 0
                    ? 'Share with a friend'
                    : `Shared with ${playlist.memberCount} ${
                        playlist.memberCount === 1 ? 'person' : 'people'
                      }`
                }
                className="pill transition-colors hover:border-white/20 hover:text-zinc-200"
              >
                <Users size={11} />
                {playlist.memberCount > 0 && playlist.memberCount}
              </button>
            )}
            {playlist.role && (
              <span className="pill" title={
                playlist.role === 'collaborator'
                  ? 'You can add and remove tracks'
                  : 'You can listen and download'
              }>
                {playlist.role === 'collaborator' ? 'Collaborator' : 'Viewer'}
              </span>
            )}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={tracks.length === 0}
              onClick={() => playTracks(tracks, 0)}
              className="btn-primary disabled:opacity-40"
            >
              <Play size={16} className="fill-current" />
              Play
            </button>
            <button
              type="button"
              disabled={tracks.length === 0}
              onClick={() => playTracks(tracks, Math.floor(Math.random() * tracks.length))}
              className="btn-ghost disabled:opacity-40"
            >
              <Shuffle size={15} />
              Shuffle
            </button>
            {tracks.length > 0 && (
              <a
                href={mediaUrl.downloadPlaylist(playlist.id)}
                download
                className="btn-ghost"
                title={`Download all ${tracks.length} tracks as one .zip`}
              >
                <Download size={15} />
                Download
                <span className="text-zinc-600">· {formatBytes(playlistBytes)}</span>
              </a>
            )}
            <ShareButton
              attachment={{
                kind: 'playlist',
                id: playlist.id,
                name: playlist.name,
                subtitle: `${playlist.trackCount} tracks · ${
                  playlist.ownerDisplayName || playlist.ownerUsername
                }`,
              }}
              className="icon-btn h-9 w-9"
              label=""
            />

            {/* Somebody else's playlist: keep it, or stop keeping it. */}
            <SavePlaylistButton playlist={playlist} />

            {playlist.kind !== 'manual' && (
              <button
                type="button"
                onClick={() => refresh.mutate()}
                disabled={refresh.isPending}
                className="btn-ghost"
                title="Rebuild it from what you have played since"
              >
                {refresh.isPending ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <RefreshCw size={15} />
                )}
                Refresh
              </button>
            )}

            {/* Name, description, cover, privacy and deleting all live in the
                one card now, rather than spread over the page. */}
            {playlist.isOwner && playlist.kind === 'manual' && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                aria-label="Edit this playlist"
                title="Edit this playlist"
                className="icon-btn h-9 w-9"
              >
                <Pencil size={16} />
              </button>
            )}
          </div>
        </div>
      </header>

      {entries.length === 0 ? (
        <EmptyState
          icon={<ListMusic size={24} />}
          title="Nothing in here yet"
          description={
            playlist.kind === 'wrapped'
              ? 'Nothing in this window yet. Play a few things and refresh.'
              : playlist.canEdit
                ? 'Use the playlist button on any track row to add music.'
                : 'The owner has not added anything yet.'
          }
        />
      ) : (
        <div className="surface divide-y divide-white/[0.03] p-1.5">
          {entries.map((entry, index) => {
            const isCurrent = entry.track && current?.id === entry.track.id;
            return (
              <div
                key={entry.trackId}
                className={`group grid grid-cols-[2rem_1fr_auto] items-center gap-3 rounded-xl px-2 py-2 transition-colors sm:gap-4 sm:px-3 ${
                  isCurrent ? 'bg-accent-500/10' : 'hover:bg-white/[0.04]'
                }`}
              >
                <button
                  type="button"
                  disabled={!entry.track}
                  onClick={() => {
                    if (!entry.track) return;
                    if (isCurrent) toggle();
                    // Playing row N means playing the list from N, so the rest
                    // of the playlist queues up behind it.
                    else playTracks(tracks, tracks.findIndex((track) => track.id === entry.trackId));
                  }}
                  aria-label={`Play ${entry.title}`}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-sm tabular-nums text-zinc-500 transition-colors hover:text-white disabled:opacity-30"
                >
                  <span className="group-hover:hidden">{index + 1}</span>
                  <Play
                    size={14}
                    className={`hidden fill-current group-hover:block ${
                      isCurrent && isPlaying ? 'text-accent-300' : 'text-white'
                    }`}
                  />
                </button>

                <div className="min-w-0">
                  <p
                    className={`truncate text-sm font-medium ${
                      entry.track ? 'text-zinc-100' : 'text-zinc-500 line-through'
                    }`}
                  >
                    {entry.title}
                  </p>
                  <p className="truncate text-xs text-zinc-500">
                    {entry.artist}
                    {entry.album && ` · ${entry.album}`}
                    {!entry.track && ' · missing from the library'}
                  </p>
                </div>

                <div className="flex items-center gap-1">
                  {playlist.canEdit && (
                    <div className="flex items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 max-sm:opacity-100">
                      <button
                        type="button"
                        disabled={index === 0 || move.isPending}
                        onClick={() => move.mutate({ trackId: entry.trackId, to: index - 1 })}
                        aria-label={`Move ${entry.title} up`}
                        className="icon-btn h-8 w-8 disabled:opacity-25"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        type="button"
                        disabled={index === entries.length - 1 || move.isPending}
                        onClick={() => move.mutate({ trackId: entry.trackId, to: index + 1 })}
                        aria-label={`Move ${entry.title} down`}
                        className="icon-btn h-8 w-8 disabled:opacity-25"
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        type="button"
                        disabled={removeTrack.isPending}
                        onClick={() => removeTrack.mutate(entry.trackId)}
                        aria-label={`Remove ${entry.title}`}
                        className="icon-btn h-8 w-8 hover:text-red-400"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}
                  <span className="w-11 shrink-0 text-right text-xs tabular-nums text-zinc-500">
                    {formatDuration(entry.duration)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {membersOpen && <PlaylistMembers playlist={playlist} onClose={() => setMembersOpen(false)} />}

      {editing && (
        <PlaylistEditor
          playlist={playlist}
          onClose={() => setEditing(false)}
          onDeleted={() => navigate('/playlists')}
        />
      )}

      {missing > 0 && (
        <p className="mt-3 text-xs text-zinc-600">
          {missing} {missing === 1 ? 'track is' : 'tracks are'} no longer in the library — they were
          renamed, re-tagged or removed since being added.
        </p>
      )}
    </div>
  );
}
